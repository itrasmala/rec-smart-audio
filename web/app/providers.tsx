"use client";
import { AppShell } from "@/components/shell";
import { FeedbackProvider } from "@/components/ui";
import { AuthProvider } from "@/lib/auth";
import { LiveProvider } from "@/lib/live";
import { PrefsProvider } from "@/lib/prefs";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrefsProvider>
      <FeedbackProvider>
        <AuthProvider>
          <LiveProvider>
            <AppShell>{children}</AppShell>
          </LiveProvider>
        </AuthProvider>
      </FeedbackProvider>
    </PrefsProvider>
  );
}
