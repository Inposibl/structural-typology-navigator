import type { Metadata, Viewport } from "next";

import { ChatInterface } from "@/components/chat/chat-interface";

export const metadata: Metadata = {
  title: "Навигатор",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
};

export default function EmbedPage() {
  return <ChatInterface variant="embedded" />;
}
