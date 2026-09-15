// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalClockingWorkspace } from "./personal-clocking-workspace";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient }));
vi.mock("@ze/ui-foundations/brands", () => ({ ZeControlLogo: () => null }));
vi.mock("lucide-react", async (importOriginal) => {
  const icons = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(icons).map((name) => [name, () => null]));
});

const oldArrival = {
  id: "yesterday-start", type: "start", event_status: "accepted",
  pointed_at: "2026-09-14T08:00:00.000Z", lat: 5, long: -4,
};
const newArrival = {
  ...oldArrival, id: "today-start", pointed_at: "2026-09-15T08:30:00.000Z",
};

function setup({ mode = "agent", status = "accepted", arrivalError = false } = {}) {
  const writes: { table: string; payload: Record<string, unknown> }[] = [];
  let resolveArrival!: () => void;
  const arrivalSaved = new Promise<void>((resolve) => { resolveArrival = resolve; });
  let requestError = false;
  const client = {
    schema: () => client,
    rpc: () => Promise.resolve({ data: null, error: null }),
    from(table: string) {
      let payload: Record<string, unknown> | undefined;
      let dayQuery = false;
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        gte: () => { dayQuery = true; return query; },
        lt: () => query,
        order: () => query,
        limit: () => query,
        single: () => query,
        insert(value: Record<string, unknown>) {
          payload = value;
          writes.push({ table, payload: value });
          return query;
        },
        then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) {
          return (async () => {
            if (payload && table === "events") {
              await arrivalSaved;
              return arrivalError
                ? { data: null, error: { message: "insert_failed" } }
                : { data: { ...newArrival, event_status: status }, error: null };
            }
            if (payload) return requestError
              ? { data: null, error: { message: "request_failed" } }
              : { data: { id: "closure-request", ...payload }, error: null };
            if (table === "events") return { data: [oldArrival], error: null };
            if (table === "orga_configs") return { data: { lat: 5, long: -4, radius: 100 }, error: null };
            return { data: [], count: 0, error: null, dayQuery };
          })().then(resolve, reject);
        },
      };
      return query;
    },
  };
  createClient.mockReturnValue(client);
  render(<PersonalClockingWorkspace
    profileId="agent" organisationId="organisation" organisationName="Test"
    fullname="Test Agent" identifier="test" canRemote timeZone="Africa/Abidjan"
    mode={mode as "agent" | "manager"} showReports={false}
  />);
  return { writes, resolveArrival, failClosure: (value: boolean) => { requestError = value; } };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T08:30:00.000Z"));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    watchPosition: (success: (position: unknown) => void) => {
      queueMicrotask(() => success({ coords: { latitude: 5, longitude: -4, accuracy: 10 } }));
      return 1;
    },
    clearWatch: vi.fn(),
  } });
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function startToday() {
  const buttons = await screen.findAllByRole("button", { name: /Commencer ma journée/ });
  fireEvent.click(buttons.at(-1)!);
}

describe("today's arrival with a previous unfinished day", () => {
  it.each(["agent", "manager"])("saves the %s arrival before asking for the forgotten departure", async (mode) => {
    const { writes, resolveArrival } = setup({ mode });
    await startToday();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ table: "events", payload: { type: "start" } });
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => resolveArrival());
    const input = await screen.findByLabelText("Heure réelle de départ");
    expect((input as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Valider mon départ" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("dialog").closest(".manager-mobile-clocking")).toBeNull();

    fireEvent.change(input, { target: { value: "17:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider mon départ" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ table: "event_change_requests", payload: {
      requested_type: "end", requested_pointed_at: "2026-09-14T17:30:00.000Z",
    } });
    expect(screen.queryByRole("button", { name: /Commencer ma journée/ })).toBeNull();
    expect(screen.getAllByText(/Le pointage d’aujourd’hui reste enregistré/).length).toBeGreaterThan(0);
  });

  it("keeps today's arrival when the departure request fails or is dismissed", async () => {
    const { writes, resolveArrival, failClosure } = setup();
    await startToday();
    await act(async () => resolveArrival());
    fireEvent.change(await screen.findByLabelText("Heure réelle de départ"), { target: { value: "17:30" } });
    failClosure(true);
    fireEvent.click(screen.getByRole("button", { name: "Valider mon départ" }));
    await screen.findByText("La demande n’a pas pu être envoyée. Réessayez.");
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /Commencer ma journée/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Renseigner le départ oublié/ }));
    expect(await screen.findByLabelText("Heure réelle de départ")).toBeDefined();
    expect(writes.filter((write) => write.table === "events")).toHaveLength(1);
  });

  it.each([{ status: "rejected" }, { arrivalError: true }])("does not ask for closure when the new arrival fails: %j", async (options) => {
    const { resolveArrival } = setup(options);
    await startToday();
    await act(async () => resolveArrival());
    await screen.findByRole("alert");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("also prompts after an arrival recorded pending review", async () => {
    const { resolveArrival } = setup({ status: "pending" });
    await startToday();
    await act(async () => resolveArrival());
    expect(await screen.findByLabelText("Heure réelle de départ")).toBeDefined();
  });
});
