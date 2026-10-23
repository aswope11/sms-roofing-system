-- THE CONTRACT RULE (10/23/26, his words — written once in lib/money.js):
-- a contract price lives on the JC ticket only. The property's contract box and the UC's contract box are gone.

-- 1. A property's contract moves onto its JC ticket (the oldest JC there, if more than one).
UPDATE jobs j SET job_contract = p.contract_amount
FROM properties p
WHERE j.property_id = p.id AND p.contract_amount IS NOT NULL AND j.tag = 'JC' AND j.job_contract IS NULL
  AND j.id = (SELECT MIN(j2.id) FROM jobs j2 WHERE j2.property_id = p.id AND j2.tag = 'JC');

-- 2. A property contract with no JC ticket to hold it is written into the property's notes, so nothing is lost.
UPDATE properties p SET notes = TRIM(BOTH FROM COALESCE(p.notes, '') || E'\n' || 'Old property contract $' || p.contract_amount || ' (10/23/26: contracts now live on the JC ticket — none here yet)')
WHERE p.contract_amount IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.property_id = p.id AND j.tag = 'JC');

-- 3. A UC (or any non-JC) no longer carries a contract. Its old number is written into its notes.
UPDATE jobs SET notes = TRIM(BOTH FROM COALESCE(notes, '') || E'\n' || 'Old contract box $' || job_contract || ' (10/23/26: only a JC has a contract price)'),
  job_contract = NULL
WHERE tag <> 'JC' AND job_contract IS NOT NULL;

ALTER TABLE properties DROP COLUMN contract_amount;

-- 4. 2264 Vantage — Skylight curbs (ticket 107): back to JC, contract $6,780, linked to its QuickBooks contract invoice #4925.
UPDATE jobs SET tag = 'JC', job_contract = 6780 WHERE id = 107;
INSERT INTO invoices (job_id, kind, name, number, amount, inv_date, scope, memo, qb_id)
SELECT 107, 'real', 'Contract', '4925', 6780, DATE '2026-10-30', COALESCE((SELECT scope FROM jobs WHERE id = 107), ''), 'JC-Contract', '14952'
WHERE EXISTS (SELECT 1 FROM jobs WHERE id = 107) AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = '4925');
