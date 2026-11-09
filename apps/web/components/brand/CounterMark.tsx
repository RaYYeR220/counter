/** Counter's mark: a counter seen from above, with one exact pick at its centre. */
export function CounterMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 22 22" width={size} height={size} aria-hidden focusable="false">
      <circle cx="11" cy="11" r="9.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11" cy="11" r="3.4" fill="var(--cx-ring, #e5533d)" />
    </svg>
  );
}
