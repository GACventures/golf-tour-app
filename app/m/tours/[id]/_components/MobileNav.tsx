// app/m/tours/[id]/_components/MobileNav.tsx
"use client";

/**
 * MobileNav has been intentionally disabled.
 *
 * Reason:
 * - The sub-navigation (Rounds / Boards / Competitions / Stats / More)
 *   is no longer required anywhere in the app.
 * - Returning null ensures it never renders, even if still imported.
 *
 * This acts as a safe global kill-switch.
 * The file is kept to avoid breaking imports.
 */

export default function MobileNav() {
  return null;
}
