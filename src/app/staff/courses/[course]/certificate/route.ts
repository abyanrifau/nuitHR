import { NextResponse } from "next/server";
import { getActiveBusiness, getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { certificatePdf } from "@/lib/training/certificate";

/** The signed-in person's certificate for a course they finished. */
export async function GET(_: Request, { params }: RouteContext<"/staff/courses/[course]/certificate">) {
  const { course } = await params;
  if (!(await getSessionUser())) return new NextResponse("Sign in first.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(course)) return new NextResponse("Not found.", { status: 404 });
  const active = await getActiveBusiness();
  if (!active?.employee_id) return new NextResponse("Your login isn't linked to a staff profile.", { status: 404 });
  const result = await certificatePdf(await createClient(), active.employee_id, course);
  if (!result) return new NextResponse("Finish the course first.", { status: 404 });
  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${result.fileName}"`,
      "cache-control": "private, no-store",
    },
  });
}
