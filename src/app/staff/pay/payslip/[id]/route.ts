import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { payslipPdf } from "@/lib/payroll/payslip";

/**
 * A payslip as a PDF. Uses the signed-in person's own access: staff get
 * only their own published payslips, payroll users get any in their company.
 */
export async function GET(_: Request, { params }: RouteContext<"/staff/pay/payslip/[id]">) {
  const { id } = await params;
  if (!(await getSessionUser())) return new NextResponse("Sign in first.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found.", { status: 404 });
  const supabase = await createClient();
  const result = await payslipPdf(supabase, id);
  if (!result) return new NextResponse("Payslip not found, or you can't see it.", { status: 404 });
  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${result.fileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
