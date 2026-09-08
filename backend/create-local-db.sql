\set ON_ERROR_STOP on
SELECT format('CREATE ROLE training_journal LOGIN PASSWORD %L', :'training_journal_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'training_journal') \gexec
SELECT 'CREATE DATABASE training_journal OWNER training_journal'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'training_journal') \gexec
REVOKE ALL ON DATABASE training_journal FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE training_journal TO training_journal;
