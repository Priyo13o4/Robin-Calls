"use client";

/**
 * A form-submit button that confirms before firing, for destructive actions
 * (delete launchpad, delete locker) that previously had no confirmation at
 * all despite cascading or scoring-affecting consequences.
 */
export function ConfirmButton({
  confirmText,
  className,
  children,
}: {
  confirmText: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
