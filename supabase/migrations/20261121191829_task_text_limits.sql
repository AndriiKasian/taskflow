-- Length limits for task text, enforced in the database as well as in the
-- Server Action (zod), so writes straight to the Data API are bounded too.
--
-- zod trims and then allows 1..200 (title) and 0..2000 (description, stored
-- as NULL when empty) characters, and the app stores the trimmed value. These
-- checks apply to the stored value, so anything the app writes passes, while
-- direct API writes cannot pad past the limit with whitespace. The existing
-- tasks_title_check (non-blank title) is unchanged.
--
-- char_length counts Unicode code points; JavaScript's length counts UTF-16
-- units, so zod is equal or stricter (an emoji is 1 here, 2 in zod) and no
-- value the app accepts is rejected here.
--
-- Adding a CHECK validates existing rows; if any row exceeds a limit the
-- migration fails as a whole and changes nothing.

alter table public.tasks
  add constraint tasks_title_length_check
    check (char_length(title) <= 200),
  add constraint tasks_description_length_check
    check (description is null or char_length(description) <= 2000);
