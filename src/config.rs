//! Configuration file handling

use anyhow::Result;
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

/// Configuration file structure (rohan.config.json)
#[allow(dead_code)]
#[derive(Debug, Deserialize, Default, Clone)]
pub struct Config {
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub api_base: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[allow(dead_code)]
impl Config {
    /// Load configuration from rohan.config.json if it exists
    pub fn load() -> Self {
        let config_path = PathBuf::from("rohan.config.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
        Config::default()
    }

    /// Load configuration from a JSON string (useful for testing)
    #[allow(dead_code)]
    pub fn from_json(json: &str) -> Result<Self> {
        serde_json::from_str(json).map_err(|e| anyhow::anyhow!("Failed to parse config: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_from_json_empty() {
        let json = "{}";
        let config = Config::from_json(json).unwrap();
        assert!(config.target.is_none());
        assert!(config.api_base.is_none());
        assert!(config.model.is_none());
    }

    #[test]
    fn test_config_from_json_full() {
        let json = r#"{
            "target": "http://localhost:8080",
            "api_base": "https://api.openai.com/v1",
            "model": "gpt-4"
        }"#;
        let config = Config::from_json(json).unwrap();
        assert_eq!(config.target, Some("http://localhost:8080".to_string()));
        assert_eq!(config.api_base, Some("https://api.openai.com/v1".to_string()));
        assert_eq!(config.model, Some("gpt-4".to_string()));
    }

    #[test]
    fn test_config_from_json_invalid() {
        let json = "not valid json";
        let result = Config::from_json(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_config_default() {
        let config = Config::default();
        assert!(config.target.is_none());
        assert!(config.api_base.is_none());
        assert!(config.model.is_none());
    }
}
