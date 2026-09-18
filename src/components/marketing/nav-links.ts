/** Marketing navigation (one place to change it). */
export const MARKETING_LINKS = [
  { label: "product", href: "/product" },
  { label: "industries", href: "/industries" },
  { label: "pricing", href: "/pricing" },
  { label: "help", href: "/help" },
] as const;

export const FOOTER_LINKS = [
  ...MARKETING_LINKS,
  { label: "contact", href: "/contact" },
  { label: "privacy", href: "/privacy" },
  { label: "terms", href: "/terms" },
] as const;
