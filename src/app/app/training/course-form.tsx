"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, CheckboxField, TextareaField, TextField } from "@/components/ui/action-form";
import { saveCourse } from "@/lib/training/actions";
import type { ActionResult } from "@/lib/errors";

export interface CourseValues {
  id?: string;
  title?: string;
  description?: string;
  category?: string | null;
  estimated_minutes?: number | null;
  pass_mark?: number;
  is_mandatory?: boolean;
  certificate_enabled?: boolean;
}

export function CourseForm({ values = {} }: { values?: CourseValues }) {
  const router = useRouter();
  const action = useCallback((s: ActionResult, f: FormData) => saveCourse(values.id ?? null, s, f), [values.id]);
  return (
    <ActionForm
      action={action}
      submitLabel={values.id ? "Save" : "Create course"}
      onSuccess={(s: ActionResult & { id?: string }) => {
        if (s.id && !values.id) router.push(`/app/training/${s.id}`);
        else router.refresh();
      }}
    >
      <TextField name="title" label="Course name" defaultValue={values.title} placeholder="For example Food safety basics" />
      <TextareaField name="description" label="What it covers" optional defaultValue={values.description} rows={3} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField name="category" label="Category" optional defaultValue={values.category ?? ""} placeholder="For example Kitchen" />
        <TextField name="estimated_minutes" label="Takes about (minutes)" type="number" min={1} optional defaultValue={values.estimated_minutes ?? ""} />
        <TextField name="pass_mark" label="Quiz pass mark (%)" type="number" min={0} max={100} defaultValue={values.pass_mark ?? 70} />
      </div>
      <CheckboxField name="is_mandatory" label="Required for everyone it's assigned to" defaultChecked={values.is_mandatory ?? false} />
      <CheckboxField name="certificate_enabled" label="Give a certificate when finished" defaultChecked={values.certificate_enabled ?? true} />
    </ActionForm>
  );
}
