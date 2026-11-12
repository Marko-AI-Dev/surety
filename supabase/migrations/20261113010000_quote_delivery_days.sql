-- Phase 4d: a committed quote carries its delivery days. They are stored beside the quote, so the
-- deal's SupplierQuote and its hash stay exactly as in 4b. 4c rows keep a quote with no days.

alter table sourcing_suppliers
  add column delivery_days integer check (delivery_days between 1 and 365),
  add constraint sourcing_suppliers_days_need_quote check (delivery_days is null or quote is not null);
