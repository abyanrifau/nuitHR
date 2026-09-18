import "server-only";

/**
 * Text message and WhatsApp sending. Not connected yet: these are the
 * slots a provider (for example Dhiraagu or Ooredoo SMS, or the WhatsApp
 * Business API) plugs into later. Until then they report "not set up" and
 * nothing is sent.
 */
export interface MessageChannel {
  key: "sms" | "whatsapp";
  label: string;
  isConfigured(): boolean;
  send(to: string, text: string): Promise<{ ok: boolean; error?: string }>;
}

function notConnected(key: MessageChannel["key"], label: string): MessageChannel {
  return {
    key,
    label,
    isConfigured: () => false,
    send: async () => ({ ok: false, error: `${label} isn't connected yet.` }),
  };
}

export const MESSAGE_CHANNELS: MessageChannel[] = [notConnected("sms", "Text messages (SMS)"), notConnected("whatsapp", "WhatsApp")];
