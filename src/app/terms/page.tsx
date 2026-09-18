import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { appConfig } from "@/config/app.config";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  const { name, legalName, supportEmail } = appConfig.brand;
  return (
    <LegalPage title="Terms of service" updated="[DATE]">
      <p>
        These terms apply when you use {name}, provided by {legalName}. By creating an account you agree to them.
      </p>
      <h2>Your account</h2>
      <p>Keep your sign-in details private. You are responsible for activity under your account and for the people you invite.</p>
      <h2>Free trial and billing</h2>
      <p>
        New businesses get a {appConfig.trial.days}-day free trial. After that, fees are based on the modules you choose and your number of employees,
        as shown on the pricing page.
      </p>
      <h2>Your data</h2>
      <p>You own the data you put into {name}. You can export it at any time from Settings.</p>
      <h2>Payroll and statutory figures</h2>
      <p>
        {name} calculates pay, tax and pension from the rates you configure. You are responsible for checking that those rates are current and that
        filings you submit are correct.
      </p>
      <h2>Contact</h2>
      <p>{supportEmail}</p>
    </LegalPage>
  );
}
