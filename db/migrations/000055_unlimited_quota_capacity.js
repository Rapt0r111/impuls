// Безлимитная квота: capacity IS NULL означает «без лимита». Счётчики резерва и выдач сохраняются.
// Проверку занятых мест ищем по определению: её имя зависит от порядка прежних CHECK таблицы.
const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE impuls.quota_periods ALTER COLUMN capacity DROP NOT NULL;
    ALTER TABLE impuls.quota_periods DROP CONSTRAINT quota_periods_capacity_check;
    ALTER TABLE impuls.quota_periods ADD CONSTRAINT quota_periods_capacity_check CHECK (capacity IS NULL OR capacity BETWEEN 0 AND 1000000);
    DO $$ DECLARE c record; BEGIN
      FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='impuls.quota_periods'::regclass AND contype='c'
        AND pg_get_constraintdef(oid) LIKE '%reserved%' AND pg_get_constraintdef(oid) LIKE '%capacity%' LOOP
        EXECUTE format('ALTER TABLE impuls.quota_periods DROP CONSTRAINT %I', c.conname);
      END LOOP;
    END $$;
    ALTER TABLE impuls.quota_periods ADD CONSTRAINT quota_periods_occupancy_check CHECK (capacity IS NULL OR reserved+used <= capacity);
    ALTER TABLE impuls.quota_publications ALTER COLUMN capacity DROP NOT NULL;
    ALTER TABLE impuls.quota_publications DROP CONSTRAINT quota_publications_capacity_check;
    ALTER TABLE impuls.quota_publications ADD CONSTRAINT quota_publications_capacity_check CHECK (capacity IS NULL OR capacity BETWEEN 0 AND 1000000);
  `);
};
const down = () => {
  throw new Error(
    "Keep quota history; unlimited periods cannot be turned back into counted ones. Disable the application feature instead.",
  );
};
module.exports = { up, down };
