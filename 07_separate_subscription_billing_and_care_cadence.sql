-- Client Care `frequency` controls report delivery, not PayPal billing.
-- Persist the plan's actual billing cycle separately and suppress the current
-- automatic reminder cycle while billing communication is webhook-only.
BEGIN;

UPDATE public.client_services service
SET service_meta_json = jsonb_set(
        coalesce(service.service_meta_json, '{}'::jsonb),
        '{billing_cycle}',
        to_jsonb(coalesce(plan.billing_cycle, 'monthly')),
        true
    ),
    last_renewal_reminder_sent_date = service.next_renewal_date,
    updated_at = now()
FROM public.service_plans plan
WHERE service.plan_id = plan.id
  AND service.status = 'active';

COMMIT;
