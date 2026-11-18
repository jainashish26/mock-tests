"use client";

import { useTransition } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

interface LogoutButtonProps {
  /** Button text. Hidden on `size="icon"`. */
  label?: string;
  /** Where `signOut` should land. Defaults to the shared login page. */
  redirectTo?: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  /** Rounds the button into a pill, matching the existing dashboard styling. */
  pill?: boolean;
}

/**
 * Signs the user out via the `signOut` server action.
 *
 * Replaces the old `<Link href="/">` "Sign Out", which navigated home but left
 * the Supabase session cookie in place - the user was never actually logged out.
 */
export function LogoutButton({
  label = "Log off",
  redirectTo = "/auth/login",
  variant = "ghost",
  size = "default",
  className,
  pill = false,
}: LogoutButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    if (isPending) return;
    startTransition(async () => {
      await signOut(redirectTo);
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={isPending}
      onClick={handleLogout}
      aria-label={label}
      title={label}
      className={cn(pill && "rounded-full", className)}
    >
      {isPending ? (
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      ) : (
        <LogOut size={16} aria-hidden="true" />
      )}
      {size !== "icon" && <span>{isPending ? "Logging off…" : label}</span>}
    </Button>
  );
}
