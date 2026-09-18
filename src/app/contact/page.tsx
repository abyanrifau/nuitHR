import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { PageShell } from "@/components/marketing/page-shell";
import { appConfig } from "@/config/app.config";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "Contact", description: "Send us a message or chat on WhatsApp." };

export default function ContactPage() {
  const wa = `https://wa.me/${appConfig.brand.whatsappNumber.replace(/\D/g, "")}`;
  return (
    <PageShell label="contact" title="Talk to us" intro="Questions about setup, pricing or your own situation. A real person reads every message.">
      <div className="mx-auto grid max-w-7xl gap-16 px-[var(--space-gutter)] py-16 lg:grid-cols-[1.4fr_1fr] lg:py-24">
        <ContactForm />
        <aside className="space-y-8 lg:border-l lg:border-border lg:pl-12">
          <div>
            <p className="section-label">quickest</p>
            <p className="mt-3 text-muted-foreground">Message us on WhatsApp during working hours.</p>
            <a href={wa} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary", size: "lg", className: "mt-5" })}>
              <MessageCircle className="size-4" aria-hidden /> Open WhatsApp
            </a>
          </div>
          <div>
            <p className="section-label">email</p>
            <a href={`mailto:${appConfig.brand.salesEmail}`} className="mt-3 inline-block text-foreground underline underline-offset-4">
              {appConfig.brand.salesEmail}
            </a>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
