"use client";

import Link from "next/link";
import { ActionForm, SelectField } from "@/components/ui/action-form";
import { buttonClasses } from "@/components/ui/button";
import { createPerson } from "@/lib/people/actions";
import { ContactFields, EmploymentFields, PersonalFields, type OrgOptions } from "../person-fields";

export function NewPersonForm({ org, suggestedCode }: { org: OrgOptions; suggestedCode: string }) {
  return (
    <ActionForm
      action={createPerson}
      submitLabel="Add person"
      pendingLabel="Adding…"
      footer={
        <Link href="/app/people" className={buttonClasses({ variant: "ghost" })}>
          Cancel
        </Link>
      }
    >
      <Section title="About them">
        <PersonalFields />
      </Section>
      <Section title="Contact">
        <ContactFields />
      </Section>
      <Section title="Their job">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <SelectField
            name="status"
            label="Status"
            options={[
              { value: "active", label: "Active" },
              { value: "probation", label: "On probation" },
            ]}
            defaultValue="probation"
          />
        </div>
        <EmploymentFields org={org} values={{ employee_code: suggestedCode }} />
        {org.departments.length === 0 && (
          <p className="mt-3 text-[13px] text-subtle-foreground">
            No departments or job titles yet. Add them in{" "}
            <Link href="/app/people/org-chart?tab=structure" className="underline underline-offset-4">
              Company structure
            </Link>
            .
          </p>
        )}
      </Section>
    </ActionForm>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-border p-5 sm:p-6">
      <legend className="px-2 font-display text-base">{title}</legend>
      {children}
    </fieldset>
  );
}
