-- 0.18.0: titles flagged for their poster's language are checked again on the next run, now that a poster with
-- another language's tag on TMDb but the same image as the library's-language one isn't flagged (ADR-043).
UPDATE `artwork_check` SET `checked_at` = 0 WHERE `jf_id` IN (SELECT `jf_id` FROM `health_finding` WHERE `kind` = 'language');
