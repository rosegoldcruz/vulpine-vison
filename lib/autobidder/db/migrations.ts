import 'server-only';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'canonical_cabinet_brain_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL DEFAULT 'local',
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        version INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bid_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workflow_state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bid_jobs_project ON bid_jobs(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS workflow_events (
        id TEXT PRIMARY KEY,
        bid_job_id TEXT NOT NULL REFERENCES bid_jobs(id) ON DELETE CASCADE,
        from_state TEXT,
        to_state TEXT NOT NULL,
        accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
        reason TEXT,
        actor_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_events_job ON workflow_events(bid_job_id, occurred_at);

      CREATE TABLE IF NOT EXISTS source_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        original_path TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        sha256 TEXT NOT NULL,
        outcome TEXT NOT NULL,
        duplicate_of_id TEXT REFERENCES source_documents(id),
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(project_id, sha256, storage_key)
      );

      CREATE TABLE IF NOT EXISTS plan_sheets (
        id TEXT PRIMARY KEY,
        source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL CHECK (page_number > 0),
        sheet_number TEXT,
        title TEXT,
        classification TEXT,
        classification_confidence REAL,
        review_required INTEGER NOT NULL DEFAULT 0,
        render_storage_key TEXT,
        thumbnail_storage_key TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(source_document_id, page_number)
      );

      CREATE TABLE IF NOT EXISTS vision_evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        plan_sheet_id TEXT NOT NULL REFERENCES plan_sheets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        region_json TEXT,
        text_content TEXT,
        confidence REAL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS unit_types (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        accessibility TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        UNIQUE(project_id, code)
      );

      CREATE TABLE IF NOT EXISTS unit_mix_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        unit_type_id TEXT NOT NULL REFERENCES unit_types(id),
        extracted_count INTEGER NOT NULL CHECK (extracted_count >= 0),
        verified_count INTEGER CHECK (verified_count >= 0),
        status TEXT NOT NULL,
        discrepancy TEXT,
        evidence_ids_json TEXT NOT NULL DEFAULT '[]',
        approved_by TEXT,
        approved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS cabinet_instances (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        unit_type_id TEXT NOT NULL REFERENCES unit_types(id),
        room TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity_per_unit INTEGER NOT NULL CHECK (quantity_per_unit > 0),
        status TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL DEFAULT '[]',
        payload_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS takeoff_lines (
        id TEXT PRIMARY KEY,
        bid_job_id TEXT NOT NULL REFERENCES bid_jobs(id) ON DELETE CASCADE,
        cabinet_instance_id TEXT NOT NULL REFERENCES cabinet_instances(id),
        unit_type_id TEXT NOT NULL REFERENCES unit_types(id),
        quantity_per_unit INTEGER NOT NULL CHECK (quantity_per_unit > 0),
        status TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS catalog_workbooks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_document_id TEXT REFERENCES source_documents(id),
        file_name TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        authoritative INTEGER NOT NULL DEFAULT 1,
        ingested_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS catalog_skus (
        id TEXT PRIMARY KEY,
        workbook_id TEXT NOT NULL REFERENCES catalog_workbooks(id) ON DELETE CASCADE,
        sku TEXT NOT NULL,
        cabinet_code TEXT NOT NULL,
        source_worksheet TEXT NOT NULL,
        source_row INTEGER NOT NULL CHECK (source_row > 0),
        unit_cost_cents INTEGER CHECK (unit_cost_cents >= 0),
        sell_price_cents INTEGER CHECK (sell_price_cents >= 0),
        raw_values_json TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(workbook_id, source_worksheet, source_row)
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_skus_lookup ON catalog_skus(workbook_id, sku, cabinet_code);

      CREATE TABLE IF NOT EXISTS sku_mappings (
        id TEXT PRIMARY KEY,
        takeoff_line_id TEXT NOT NULL REFERENCES takeoff_lines(id) ON DELETE CASCADE,
        catalog_sku_id TEXT REFERENCES catalog_skus(id),
        outcome TEXT NOT NULL,
        match_method TEXT NOT NULL,
        confidence REAL,
        normalization_rule_id TEXT,
        approved_by TEXT,
        approved_at TEXT,
        resolution_note TEXT
      );

      CREATE TABLE IF NOT EXISTS estimate_lines (
        id TEXT PRIMARY KEY,
        bid_job_id TEXT NOT NULL REFERENCES bid_jobs(id) ON DELETE CASCADE,
        mapping_id TEXT REFERENCES sku_mappings(id),
        unit_mix_entry_id TEXT REFERENCES unit_mix_entries(id),
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        project_quantity INTEGER NOT NULL CHECK (project_quantity >= 0),
        unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
        extended_cost_cents INTEGER NOT NULL CHECK (extended_cost_cents >= 0),
        currency TEXT NOT NULL,
        calculation_version TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS qa_results (
        id TEXT PRIMARY KEY,
        bid_job_id TEXT NOT NULL REFERENCES bid_jobs(id) ON DELETE CASCADE,
        safe_to_send INTEGER NOT NULL CHECK (safe_to_send IN (0, 1)),
        issues_json TEXT NOT NULL,
        reconciliation_json TEXT NOT NULL,
        reviewer_requirements_json TEXT NOT NULL,
        calculation_version TEXT NOT NULL,
        executed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        bid_job_id TEXT NOT NULL REFERENCES bid_jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        note TEXT,
        actor_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        project_id TEXT,
        actor_id TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        correlation_id TEXT,
        before_json TEXT,
        after_json TEXT,
        outcome TEXT NOT NULL,
        reason TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_events(project_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS export_artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        bid_job_id TEXT NOT NULL REFERENCES bid_jobs(id) ON DELETE CASCADE,
        snapshot_id TEXT NOT NULL,
        format TEXT NOT NULL,
        audience TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        status TEXT NOT NULL,
        storage_key TEXT,
        mime_type TEXT,
        byte_size INTEGER,
        sha256 TEXT,
        generated_by TEXT NOT NULL,
        generated_at TEXT,
        qa_result_id TEXT REFERENCES qa_results(id),
        warnings_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        bid_job_id TEXT NOT NULL REFERENCES bid_jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        current_stage TEXT,
        last_progress_at TEXT,
        heartbeat_at TEXT,
        checkpoint_json TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        next_attempt_at TEXT,
        control_reason TEXT,
        started_at TEXT,
        completed_at TEXT,
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS progress_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        stage TEXT NOT NULL,
        unit TEXT NOT NULL,
        completed INTEGER NOT NULL CHECK (completed >= 0),
        total INTEGER CHECK (total >= 0),
        message TEXT,
        occurred_at TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS processing_settings (
        principal_id TEXT PRIMARY KEY,
        automatic_retries INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 0 AND 10),
        retry_delay_ms INTEGER NOT NULL DEFAULT 1000 CHECK (retry_delay_ms BETWEEN 100 AND 600000),
        retry_server_errors INTEGER NOT NULL DEFAULT 1,
        worker_concurrency INTEGER NOT NULL DEFAULT 2 CHECK (worker_concurrency BETWEEN 1 AND 8),
        stall_threshold_ms INTEGER NOT NULL DEFAULT 120000,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS measurements (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        plan_sheet_id TEXT NOT NULL REFERENCES plan_sheets(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        geometry_json TEXT NOT NULL,
        calibration_json TEXT,
        value REAL,
        unit TEXT,
        printed_dimension_override INTEGER NOT NULL DEFAULT 0 CHECK (printed_dimension_override = 0),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS evidence_snippets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        plan_sheet_id TEXT NOT NULL REFERENCES plan_sheets(id) ON DELETE CASCADE,
        region_json TEXT NOT NULL,
        scale REAL,
        annotations_json TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL,
        storage_key TEXT,
        takeoff_line_id TEXT REFERENCES takeoff_lines(id),
        qa_issue_id TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        project_id TEXT,
        bid_job_id TEXT,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        target_path TEXT,
        occurred_at TEXT NOT NULL,
        read_at TEXT,
        dismissed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS deals (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        company_name TEXT NOT NULL,
        stage TEXT NOT NULL,
        approved_bid_cents INTEGER,
        expected_revenue_cents INTEGER,
        realized_revenue_cents INTEGER,
        currency TEXT NOT NULL DEFAULT 'USD',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operational_events (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount_cents INTEGER,
        payload_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS outreach_activities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        deal_id TEXT REFERENCES deals(id),
        status TEXT NOT NULL,
        provider TEXT,
        recipient TEXT,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        artifact_ids_json TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sent_at TEXT
      );

      CREATE TABLE IF NOT EXISTS provider_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        provider_type TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        status TEXT NOT NULL,
        external_record_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        retrieved_at TEXT,
        error_code TEXT
      );
    `,
  },
  {
    version: 2,
    name: 'processing_settings_payload',
    sql: `
      ALTER TABLE processing_settings ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 3,
    name: 'ingestion_manifests',
    sql: `
      CREATE TABLE IF NOT EXISTS ingestion_manifests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ingestion_manifest_entries (
        id TEXT PRIMARY KEY,
        manifest_id TEXT NOT NULL REFERENCES ingestion_manifests(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        original_path TEXT NOT NULL,
        normalized_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        outcome TEXT NOT NULL,
        sha256 TEXT,
        size_bytes INTEGER NOT NULL,
        reason_code TEXT,
        reason TEXT,
        duplicate_of_id TEXT,
        entry_json TEXT NOT NULL,
        UNIQUE(manifest_id, ordinal)
      );
    `,
  },
  {
    version: 4,
    name: 'backoffice_logistics_grounding',
    sql: `
      CREATE TABLE IF NOT EXISTS freight_quotes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'rejected', 'expired')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        currency TEXT NOT NULL,
        provider TEXT,
        approved_by TEXT,
        approved_at TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_freight_quotes_project
        ON freight_quotes(project_id, status, updated_at DESC);
    `,
  },
  {
    version: 5,
    name: 'per_document_processing_queue',
    sql: `
      CREATE TABLE IF NOT EXISTS file_queue_items (
        id TEXT PRIMARY KEY,
        bid_job_id TEXT NOT NULL REFERENCES bid_jobs(id) ON DELETE CASCADE,
        source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        stage TEXT,
        completed_units INTEGER NOT NULL DEFAULT 0 CHECK (completed_units >= 0),
        total_units INTEGER CHECK (total_units >= 0),
        attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
        failure_code TEXT,
        failure_reason TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(bid_job_id, source_document_id)
      );
      CREATE INDEX IF NOT EXISTS idx_file_queue_job_status ON file_queue_items(bid_job_id, status, updated_at);
    `,
  },
  {
    version: 6,
    name: 'non_destructive_queue_dismissal',
    sql: `
      ALTER TABLE job_runs ADD COLUMN dismissed_at TEXT;
      ALTER TABLE file_queue_items ADD COLUMN dismissed_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_job_runs_visible ON job_runs(bid_job_id, dismissed_at);
      CREATE INDEX IF NOT EXISTS idx_file_queue_visible ON file_queue_items(bid_job_id, dismissed_at);
    `,
  },
  {
    version: 7,
    name: 'qa_notes_and_warnings',
    sql: `
      ALTER TABLE qa_results ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE qa_results ADD COLUMN informational_notes_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 8,
    name: 'project_review_comments',
    sql: `
      CREATE TABLE IF NOT EXISTS project_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT 'review',
        resource_type TEXT,
        resource_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_comments_project ON project_comments(project_id, created_at DESC);
    `,
  },
];
