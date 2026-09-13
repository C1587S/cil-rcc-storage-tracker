fn main() {
    let raw = std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap();
    let m: manifest_types::Manifest = serde_json::from_str(&raw).expect("manifest does not match Rust types");
    println!("RUST PARSE OK: {} entries, {} bytes, owner {}", m.entries.len(), m.total_bytes, m.owner_uname);
    let r = manifest_types::Receipt {
        version: 1, manifest_id: m.manifest_id, executor: m.owner_uname, action: "quarantine".into(),
        dry_run: true, started_at: "t".into(), finished_at: "t".into(), outcomes: vec![],
        bytes_freed: 0, files_removed: 0, files_skipped_changed: 0, files_skipped_missing: 0,
        files_failed: 0, dirs_removed: 0,
    };
    println!("receipt serializes: {}", serde_json::to_string(&r).unwrap().len() > 0);
}
