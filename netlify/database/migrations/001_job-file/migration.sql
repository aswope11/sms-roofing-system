CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE properties (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  address TEXT NOT NULL,
  address_key TEXT NOT NULL,
  city TEXT DEFAULT '',
  tenant TEXT DEFAULT '',
  gc TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX properties_address_key ON properties(address_key, city);
CREATE TABLE jobs (
  id SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  tag TEXT NOT NULL CHECK (tag IN ('BID','R','CO','UC','JC')),
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE files (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  drawer TEXT NOT NULL,
  name TEXT NOT NULL,
  content_type TEXT DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL,
  chunks INTEGER NOT NULL,
  blob_key TEXT NOT NULL,
  complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
