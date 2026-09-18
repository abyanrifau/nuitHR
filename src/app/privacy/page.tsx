import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { appConfig } from "@/config/app.config";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  const { name, legalName, supportEmail } = appConfig.brand;
  return (
    <LegalPage title="Privacy policy" updated="[DATE]">
      <p>
        This policy explains how {legalName} (&quot;we&quot;) handles personal information when businesses and their staff use {name}.
      </p>
      <h2>Who is responsible for employee data</h2>
      <p>
        Each business that uses {name} decides what employee information to store and why. For that information, the business is the data controller
        and we process it on their behalf.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email, phone number and sign-in activity.</li>
        <li>Information businesses enter about their employees, such as job, attendance, leave and pay details.</li>
        <li>Location and photos only when a business turns on GPS or selfie clock-in, and only at the moment of clocking in or out.</li>
      </ul>
      <h2>How we protect it</h2>
      <p>
        Each business&apos;s data is kept separate from every other business. Access is limited by role, and sensitive actions are recorded in an
        activity log.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your information or ask for it to be corrected or deleted. Staff should contact their employer first. For anything
        else, email {supportEmail}.
      </p>
      <h2>Contact</h2>
      <p>{supportEmail}</p>
    </LegalPage>
  );
}
