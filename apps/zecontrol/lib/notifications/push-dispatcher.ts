import "server-only";

import webpush from "web-push";
import {
  currentWorkPolicyReminder,
  type EvaluatedClockingEvent,
} from "@/lib/work-policy-evaluation";
import { isWorkPolicyDefinition } from "@/lib/work-policy";
import { createAdminClient } from "@/lib/supabase/admin";

type NotificationContext = {
  profile_id: string;
  organisation_id: string;
  timezone: string;
  work_date: string;
  events: EvaluatedClockingEvent[] | null;
  resolved_policy: { definition?: unknown } | null;
};

type PushSubscriptionRow = {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  expires_at: string | null;
};

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) {
    throw new Error("La configuration VAPID est incomplète.");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function pushStatus(error: unknown) {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : null;
}

export async function dispatchDueNotifications(now = new Date()) {
  configureWebPush();
  const admin = createAdminClient();
  const stalePendingBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  const { error: staleCleanupError } = await admin
    .schema("zecontrol")
    .from("notification_deliveries")
    .delete()
    .eq("status", "pending")
    .lt("created_at", stalePendingBefore);
  if (staleCleanupError) throw staleCleanupError;

  const { data: contextData, error: contextError } = await admin
    .schema("zecontrol")
    .rpc("notification_dispatch_contexts", { batch_size: 500 });
  if (contextError) throw contextError;
  const contexts = (contextData ?? []) as NotificationContext[];
  if (!contexts.length) {
    return { processed: true, profiles: 0, reminders: 0, devices: 0, failures: 0 };
  }

  const profileIds = contexts.map((context) => context.profile_id);
  const { data: subscriptionData, error: subscriptionError } = await admin
    .schema("zecontrol")
    .from("push_subscriptions")
    .select("id, profile_id, endpoint, p256dh, auth_key, expires_at")
    .in("profile_id", profileIds);
  if (subscriptionError) throw subscriptionError;

  const subscriptionsByProfile = new Map<string, PushSubscriptionRow[]>();
  for (const subscription of (subscriptionData ?? []) as PushSubscriptionRow[]) {
    const current = subscriptionsByProfile.get(subscription.profile_id) ?? [];
    current.push(subscription);
    subscriptionsByProfile.set(subscription.profile_id, current);
  }

  const totals = { reminders: 0, devices: 0, failures: 0 };
  async function processContext(context: NotificationContext) {
    const definition = context.resolved_policy?.definition;
    if (!isWorkPolicyDefinition(definition)) return;
    const reminder = currentWorkPolicyReminder({
      definition: {
        ...definition,
        daySchedules: definition.daySchedules ?? {},
      },
      events: context.events ?? [],
      now,
      timeZone: context.timezone,
    });
    if (!reminder) return;

    const { data: delivery, error: reservationError } = await admin
      .schema("zecontrol")
      .from("notification_deliveries")
      .insert({
        profile_id: context.profile_id,
        organisation_id: context.organisation_id,
        work_date: context.work_date,
        reminder_key: reminder.key,
        title: reminder.title,
        body: reminder.message,
        status: "pending",
      })
      .select("id")
      .single();
    if (reservationError?.code === "23505") return;
    if (reservationError || !delivery) {
      totals.failures += 1;
      console.error("zecontrol_notification_reservation_failed", {
        profile_id: context.profile_id,
        code: reservationError?.code,
      });
      return;
    }

    const subscriptions = subscriptionsByProfile.get(context.profile_id) ?? [];
    let sentDevices = 0;
    await Promise.all(subscriptions.map(async (subscription) => {
      if (
        subscription.expires_at &&
        new Date(subscription.expires_at).getTime() <= now.getTime()
      ) {
        await admin
          .schema("zecontrol")
          .from("push_subscriptions")
          .delete()
          .eq("id", subscription.id);
        return;
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            expirationTime: subscription.expires_at
              ? new Date(subscription.expires_at).getTime()
              : null,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth_key,
            },
          },
          JSON.stringify({
            title: reminder.title,
            body: reminder.message,
            tag: `zecontrol-${context.profile_id}-${context.work_date}-${reminder.key}`,
            url: "/dashboard/pointage",
          }),
          { TTL: 10 * 60, urgency: "normal" },
        );
        sentDevices += 1;
      } catch (error) {
        totals.failures += 1;
        const status = pushStatus(error);
        if (status === 404 || status === 410) {
          await admin
            .schema("zecontrol")
            .from("push_subscriptions")
            .delete()
            .eq("id", subscription.id);
        }
        console.warn("zecontrol_push_send_failed", {
          subscription_id: subscription.id,
          status,
        });
      }
    }));

    if (sentDevices === 0) {
      await admin
        .schema("zecontrol")
        .from("notification_deliveries")
        .delete()
        .eq("id", delivery.id);
      return;
    }

    const { error: deliveryUpdateError } = await admin
      .schema("zecontrol")
      .from("notification_deliveries")
      .update({
        status: "sent",
        sent_at: now.toISOString(),
        device_count: sentDevices,
      })
      .eq("id", delivery.id);
    if (deliveryUpdateError) {
      totals.failures += 1;
      console.error("zecontrol_notification_delivery_update_failed", {
        delivery_id: delivery.id,
        code: deliveryUpdateError.code,
      });
    }
    totals.reminders += 1;
    totals.devices += sentDevices;
  }

  for (let offset = 0; offset < contexts.length; offset += 8) {
    await Promise.all(contexts.slice(offset, offset + 8).map(processContext));
  }

  const { error: checkedUpdateError } = await admin
    .schema("zecontrol")
    .from("push_subscriptions")
    .update({ last_checked_at: now.toISOString() })
    .in("profile_id", profileIds);
  if (checkedUpdateError) {
    totals.failures += 1;
    console.error("zecontrol_notification_check_update_failed", {
      code: checkedUpdateError.code,
    });
  }

  return {
    processed: true,
    profiles: contexts.length,
    ...totals,
  };
}
