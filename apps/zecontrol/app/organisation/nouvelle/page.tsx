import { redirect } from "next/navigation";
export default async function NewOrganisationPage() {
  redirect("/dashboard/organisation/nouvelle");
}
