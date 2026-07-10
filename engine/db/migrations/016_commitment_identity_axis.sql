-- Adaptive Allocation Engine's identity_axis field (engine-specs/
-- adaptive-allocation-engine-v1.1.md §2.2) applied to real commitments for
-- the first time -- until now the field only existed in the spec's JSON
-- example, nothing ever set it. This is what lets a commitment's completed
-- time actually count toward current_hours_per_week for its axis, and lets
-- the NOW screen show which part of someone's life a given action feeds.
alter table commitments add column if not exists identity_axis text
  check (identity_axis is null or identity_axis in
    ('foundation', 'relationships', 'achievement', 'finance', 'contribution', 'recreation'));

comment on column commitments.identity_axis is
  'Which identity-spectrum axis this commitment counts toward, or null for things that deliberately don''t map to one (e.g. medication -- adherence-class, governed separately per the Adherence Addendum, not part of the want/need spectrum).';
