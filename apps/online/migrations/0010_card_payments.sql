CREATE INDEX card_payments_visible ON orders(id DESC)
WHERE coalesce(json_extract(data,'$.card_history_hidden'),0)=0
  AND coalesce(json_extract(data,'$.stats_cleared'),0)=0
  AND coalesce(json_extract(data,'$.gift'),0)=0
  AND json_extract(data,'$.payment.card_amount')>0;
