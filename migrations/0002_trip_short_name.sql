ALTER TABLE trips ADD COLUMN trip_short_name TEXT;

CREATE INDEX idx_trips_short_name
  ON trips(feed_id, trip_short_name);
