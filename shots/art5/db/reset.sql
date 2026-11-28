update bym.save set rewards = coalesce(rewards,'{}'::jsonb)
  || '{"mmCrystals":{"id":"mmCrystals","value":50},"championAbilities":{"id":"championAbilities","value":{"1":1,"2":2,"3":3}},"korathPower":{"id":"korathPower","value":1}}'::jsonb
where userid=2503 and type='main' returning basesaveid;
