-- FR-78 (owner 2026-11-16, "Yes, add them"): Melipayamak web-service refusals in plain English.
--
-- A refused send replies {Value: "<code>", RetStatus: 35, StrRetStatus: "InvalidData"}; the reason is
-- the code in Value. The first live test failed with Value 14 (the text contains a link), shown as
-- "InvalidData (RetStatus 35, Value 14)". Codes from https://www.melipayamak.com/api/sendsms/
-- (2026-11-16). Each known code shows the plain reason followed by Melipayamak's raw reply (owner:
-- "show the error codes both in plain english and how it is now", for troubleshooting), e.g.
--   The text contains a link … — InvalidData (RetStatus 35, Value 14)
-- Unknown codes show the raw reply alone. Admin panel is English-only.
--
-- Same signature; CREATE OR REPLACE keeps the ACL (no grants).

CREATE OR REPLACE FUNCTION private.sms_ws_error(p_reply jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case when plain is null then raw else plain || ' — ' || raw end
  from (
    select coalesce(nullif(p_reply->>'StrRetStatus', ''), 'error')
             || ' (RetStatus ' || coalesce(r, '?') || ', Value ' || coalesce(v, '?') || ')' as raw,
           case
             when v in ('-110', '110') then 'Melipayamak wants the API key, not the panel password'
             when v in ('-109', '109') then 'This server''s IP is not on the allowed list in the Melipayamak panel'
             when v in ('-108', '108') then 'Melipayamak blocked this server''s IP after failed attempts; contact their support'
             when r = '0' or v = '0' then 'Wrong username or API key'
             when v = '2' then 'Not enough credit in the Melipayamak panel'
             when v = '3' then 'Daily send limit reached; contact Melipayamak support'
             when v = '4' then 'Send volume limit reached; contact Melipayamak support'
             when v = '5' then 'The sender line is not valid for this account'
             when v = '6' then 'Melipayamak is updating; send again in a few minutes'
             when v = '7' then 'The text contains a filtered word; contact Melipayamak support'
             when v = '9' then 'Public Melipayamak lines cannot send through the web service; use your own line'
             when v = '10' then 'The Melipayamak panel is inactive'
             when v = '11' then 'Not sent; the number may block advertising texts, which a service line avoids'
             when v = '12' then 'The Melipayamak panel''s identity documents are incomplete'
             when v = '14' then 'The text contains a link; remove it from "Link at the end of each text" or ask Melipayamak support to allow links'
             when v = '15' then 'The text must end with «لغو11»; put it in "Link at the end of each text"'
             when v = '18' then 'The mobile number is not valid'
           end as plain
    from (select nullif(p_reply->>'Value', '') as v, p_reply->>'RetStatus' as r) x
  ) y;
$$;
