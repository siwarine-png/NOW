-- Adaptive Allocation Engine's fixed-vs-flexible distinction: the "168
-- hours" reallocation premise only applies to flexible time -- you can't
-- meaningfully suggest spending less time on an axis if that time is a
-- non-negotiable fixed commitment (a job shift, etc). null means unknown
-- (the common case for a fast manual chip tap with no matching registered
-- commitment) rather than an assertion that the time was free -- absence of
-- a registered commitment isn't proof it was actually discretionary.
alter table identity_checkins add column if not exists is_fixed boolean;

comment on column identity_checkins.is_fixed is
  'true = confirmed fixed/non-negotiable time (matched an active commitment''s window, or Groq classified the free-text description as an obligation). false = confirmed flexible/discretionary (Groq classified it that way). null = unknown, not asserted either way.';
