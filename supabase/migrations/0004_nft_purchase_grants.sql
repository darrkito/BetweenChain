-- Same gap as 0002_grants.sql: new tables aren't auto-exposed to the Data API
-- roles, needs explicit grants (see that file's comment for the full reasoning).

grant select, insert, update, delete on
  public.nft_purchase_quotes,
  public.nft_purchases
  to service_role;

grant select on
  public.nft_purchase_quotes,
  public.nft_purchases
  to authenticated;
