/**
 * "Tell us how you work": the setup questions and how answers turn into
 * recommended tools. Pure functions so they can be tested and reused on
 * the marketing site.
 */
import { normalizeSelection } from "./selection";
import type { ModuleKey } from "./types";

export interface QuestionOption {
  value: string;
  label: string;
}

export interface SetupQuestion {
  key: string;
  question: string;
  hint?: string;
  options: QuestionOption[];
}

const YES_NO: QuestionOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const SETUP_QUESTIONS: SetupQuestion[] = [
  {
    key: "work_pattern",
    question: "How do your staff work?",
    options: [
      { value: "shifts", label: "In shifts" },
      { value: "fixed", label: "Fixed office hours" },
      { value: "mixed", label: "A mix of both" },
    ],
  },
  { key: "track_leave", question: "Do you keep track of annual leave and sick days?", options: YES_NO },
  {
    key: "payroll",
    question: "Where do you work out salaries?",
    options: [
      { value: "here", label: "I'd like to do it here" },
      { value: "elsewhere", label: "Somewhere else (an accountant or other software)" },
    ],
  },
  {
    key: "reimburse",
    question: "Do you pay staff back for transport or other costs?",
    hint: "Ferries, taxis, meals, supplies and so on.",
    options: YES_NO,
  },
  { key: "permits", question: "Do you employ people from other countries who need work permits?", options: YES_NO },
  { key: "hiring", question: "Are you hiring in the next few months?", options: YES_NO },
  {
    key: "starters",
    question: "When someone starts, is there a list of things to sort out?",
    hint: "Contract, ID copy, uniform, system access…",
    options: YES_NO,
  },
  {
    key: "develop",
    question: "Do you run training or performance reviews?",
    options: [
      { value: "training", label: "Training" },
      { value: "reviews", label: "Reviews" },
      { value: "both", label: "Both" },
      { value: "neither", label: "Neither yet" },
    ],
  },
];

export type SetupAnswers = Partial<Record<string, string>>;

export interface Recommendation {
  key: ModuleKey;
  reason: string;
}

/** Which tools to switch on, and a short reason for each. */
export function recommendTools(a: SetupAnswers): Recommendation[] {
  const out: Recommendation[] = [];
  const add = (key: ModuleKey, reason: string) => {
    if (!out.some((r) => r.key === key)) out.push({ key, reason });
  };
  if (a.work_pattern === "shifts") add("attendance", "Because your staff work shifts");
  if (a.work_pattern === "mixed") add("attendance", "Because some of your staff work shifts");
  if (a.track_leave === "yes") add("leave", "Because you track leave and sick days");
  if (a.payroll === "here") add("payroll", "Because you want to work out salaries here");
  if (a.reimburse === "yes") add("claims", "Because you pay staff back for costs");
  if (a.permits === "yes") add("compliance", "Because you employ people with work permits");
  if (a.hiring === "yes") add("recruitment", "Because you're hiring soon");
  if (a.hiring === "yes") add("onboarding", "Because new people will be joining");
  if (a.starters === "yes") add("onboarding", "Because new starters have a list of things to sort out");
  if (a.develop === "training" || a.develop === "both") add("learning", "Because you run training");
  if (a.develop === "reviews" || a.develop === "both") add("performance", "Because you run reviews");
  return out;
}

/** Full selection (foundation + recommended tools) for the answers given. */
export function selectionFromAnswers(a: SetupAnswers): ModuleKey[] {
  return normalizeSelection(recommendTools(a).map((r) => r.key));
}

export function isComplete(a: SetupAnswers): boolean {
  return SETUP_QUESTIONS.every((q) => !!a[q.key]);
}
