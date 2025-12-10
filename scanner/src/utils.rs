use std::fmt;

/// Format bytes in human-readable format (e.g., 1.5 GB, 256 MB)
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB", "PB"];

    if bytes == 0 {
        return "0 B".to_string();
    }

    let bytes_f = bytes as f64;
    let exponent = (bytes_f.log10() / 3.0).floor() as usize;
    let exponent = exponent.min(UNITS.len() - 1);

    let value = bytes_f / 1000_f64.powi(exponent as i32);

    format!("{:.2} {}", value, UNITS[exponent])
}

/// Format duration in human-readable format
pub fn format_duration(seconds: f64) -> String {
    if seconds < 60.0 {
        format!("{:.2}s", seconds)
    } else if seconds < 3600.0 {
        let minutes = (seconds / 60.0).floor();
        let secs = seconds % 60.0;
        format!("{}m {:.0}s", minutes, secs)
    } else {
        let hours = (seconds / 3600.0).floor();
        let minutes = ((seconds % 3600.0) / 60.0).floor();
        format!("{}h {}m", hours, minutes)
    }
}

/// Format a large number with thousands separators
pub fn format_number(num: u64) -> String {
    let s = num.to_string();
    let mut result = String::new();
    let chars: Vec<char> = s.chars().rev().collect();

    for (i, c) in chars.iter().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.insert(0, ',');
        }
        result.insert(0, *c);
    }

    result
}

/// Calculate percentage
pub fn percentage(part: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        (part as f64 / total as f64) * 100.0
    }
}

/// Validate that a path exists and is accessible
pub fn validate_path(path: &std::path::Path) -> anyhow::Result<()> {
    if !path.exists() {
        anyhow::bail!("Path does not exist: {}", path.display());
    }

    if !path.is_dir() {
        anyhow::bail!("Path is not a directory: {}", path.display());
    }

    // Try to read the directory to check permissions
    std::fs::read_dir(path)
        .map_err(|e| anyhow::anyhow!("Cannot access directory {}: {}", path.display(), e))?;

    Ok(())
}

/// Create output directory if it doesn't exist
pub fn ensure_output_dir(path: &std::path::Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| anyhow::anyhow!("Failed to create output directory: {}", e))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(500), "500.00 B");
        assert_eq!(format_bytes(1_500), "1.50 KB");
        assert_eq!(format_bytes(1_500_000), "1.50 MB");
        assert_eq!(format_bytes(1_500_000_000), "1.50 GB");
        assert_eq!(format_bytes(1_500_000_000_000), "1.50 TB");
    }

    #[test]
    fn test_format_duration() {
        assert!(format_duration(30.5).contains("30.50s"));
        assert!(format_duration(125.0).contains("2m"));
        assert!(format_duration(3725.0).contains("1h"));
    }

    #[test]
    fn test_format_number() {
        assert_eq!(format_number(0), "0");
        assert_eq!(format_number(999), "999");
        assert_eq!(format_number(1000), "1,000");
        assert_eq!(format_number(1_234_567), "1,234,567");
    }

    #[test]
    fn test_percentage() {
        assert_eq!(percentage(50, 100), 50.0);
        assert_eq!(percentage(1, 4), 25.0);
        assert_eq!(percentage(0, 100), 0.0);
        assert_eq!(percentage(100, 0), 0.0); // Avoid division by zero
    }

    #[test]
    fn test_validate_path() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        assert!(validate_path(temp_dir.path()).is_ok());

        let non_existent = temp_dir.path().join("does_not_exist");
        assert!(validate_path(&non_existent).is_err());
    }
}
