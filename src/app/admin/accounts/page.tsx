import Link from "next/link";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { adminTitle, requirePlatformAdmin } from "@/lib/platform/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { DeleteAccountButton } from "./delete-client";

export async function generateMetadata() {
  return adminTitle("Logins");
}

export interface AdminAccount {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  confirmed: boolean;
  is_platform_admin: boolean;
  memberships: { business_id: string; business_name: string; role: string; is_owner: boolean; status: string }[];
}

/** Every login on Harbor, so test accounts can be found and removed. */
export default async function AdminAccounts(props: PageProps<"/admin/accounts">) {
  const admin = await requirePlatformAdmin();
  const q = ((await props.searchParams).q as string | undefined)?.trim().toLowerCase() ?? "";
  const { data } = await createAdminClient().rpc("admin_accounts");
  const all = (data as AdminAccount[] | null) ?? [];
  const accounts = q ? all.filter((a) => [a.email, a.name ?? "", ...a.memberships.map((m) => m.business_name)].join(" ").toLowerCase().includes(q)) : all;

  return (
    <div className="space-y-6">
      <div>
        <p className="section-label mb-1">platform admin</p>
        <h1 className="text-2xl">Logins</h1>
        <p className="text-sm text-muted-foreground">
          Everyone who has signed up to Harbor. Deleting a login removes their sign-in only; their staff record stays with the company.
        </p>
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by email, name or company"
          aria-label="Search logins"
          className="h-9 w-full max-w-sm rounded-lg border border-border bg-transparent px-3 text-sm"
        />
        <button type="submit" className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent-soft">
          Search
        </button>
      </form>

      <Table>
        <thead>
          <tr>
            <Th>Email</Th>
            <Th>Name</Th>
            <Th>Companies</Th>
            <Th>Signed up</Th>
            <Th>Last signed in</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <Tr key={a.id}>
              <Td>
                <span className="break-all">{a.email}</span>
                {!a.confirmed && <span className="block text-[12px] text-muted-foreground">Email not confirmed</span>}
                {a.is_platform_admin && <StatusDot tone="info">Harbor admin</StatusDot>}
              </Td>
              <Td>{a.name || "—"}</Td>
              <Td className="text-[13px]">
                {a.memberships.length
                  ? a.memberships.map((m) => (
                      <span key={m.business_id} className="mr-2 inline-block">
                        <Link href={`/admin/businesses/${m.business_id}`} className="underline-offset-4 hover:underline">
                          {m.business_name}
                        </Link>
                        <span className="text-subtle-foreground"> ({m.is_owner ? "owner" : m.role})</span>
                      </span>
                    ))
                  : "None"}
              </Td>
              <Td className="whitespace-nowrap tabular">{formatDate(a.created_at, "DD/MM/YYYY")}</Td>
              <Td className="whitespace-nowrap tabular">{a.last_sign_in_at ? formatDate(a.last_sign_in_at, "DD/MM/YYYY") : "Never"}</Td>
              <Td className="text-right">
                {a.id === admin.id ? (
                  <span className="text-[12px] text-subtle-foreground">You</span>
                ) : (
                  <DeleteAccountButton id={a.id} email={a.email} />
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {!accounts.length && <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">No logins found.</p>}
    </div>
  );
}
