//! Command implementations (run, plan, build, exec, validate)

use crate::cli::{BuildArgs, ExecArgs, PlanArgs};
use crate::generator::{build_scripts_from_plan, create_test_plan, ScriptCallback, TestPlan};
use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Convert a test name to a valid, descriptive filename
/// e.g., "Get_Message_With_AckTimeout" -> "test_get_message_with_acktimeout.js"
fn test_name_to_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    
    // Collapse multiple underscores and trim
    let mut result = String::new();
    let mut prev_underscore = false;
    for c in sanitized.chars() {
        if c == '_' {
            if !prev_underscore && !result.is_empty() {
                result.push(c);
            }
            prev_underscore = true;
        } else {
            result.push(c);
            prev_underscore = false;
        }
    }
    
    // Trim trailing underscores
    let result = result.trim_end_matches('_');
    
    format!("test_{}.js", result)
}

/// Validate an OpenAPI specification file
pub fn validate_spec(path: &PathBuf) -> Result<openapiv3::OpenAPI> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("Failed to read spec file at {:?}", path))?;

    let spec: openapiv3::OpenAPI = serde_json::from_str(&content)
        .with_context(|| "Failed to parse OpenAPI spec as JSON")?;

    println!("  📋 Title: {}", spec.info.title);
    println!("  📌 Version: {}", spec.info.version);
    println!("  🔗 Endpoints: {}", spec.paths.paths.len());

    Ok(spec)
}

/// Generate test plan and save to JSON file
/// The output can be used by the 'build' command to generate test scripts
pub fn generate_plan(args: &PlanArgs) -> Result<()> {
    // 1. Parse OpenAPI Spec
    println!("🔍 Parsing OpenAPI spec...");
    let spec_content = fs::read_to_string(&args.spec_path)
        .with_context(|| format!("Failed to read spec file at {:?}", args.spec_path))?;

    let spec: openapiv3::OpenAPI = serde_json::from_str(&spec_content)
        .with_context(|| "Failed to parse OpenAPI spec as JSON")?;

    println!("✅ Found API: {} (v{})", spec.info.title, spec.info.version);

    // 2. Generate Test Plan
    let plan_type = if args.e2e { "E2E Test Plan" } else { "Test Plan" };
    println!("\n📐 Generating {} with LLM ({}) ...", plan_type, args.model);
    let plan = create_test_plan(
        &spec_content,
        &args.spec_path.to_string_lossy(),
        args.api_base.as_deref(),
        &args.model,
        args.prompt_dir.clone(),
        args.workers,
        args.rpm,
        args.batch_size,
        args.e2e,
    )?;

    // 3. Save plan to JSON file
    plan.save(&args.output)?;
    println!("\n💾 Saved test plan to {:?}", args.output);
    
    if args.e2e {
        println!("   {} E2E scenarios for {} (v{})", plan.scenarios.len(), plan.api_title, plan.api_version);
        
        println!("\n📝 E2E Scenarios:");
        for (i, scenario) in plan.scenarios.iter().enumerate().take(20) {
            println!("  {}. {} ({} steps)", i + 1, scenario.name, scenario.steps.len());
        }
        if plan.scenarios.len() > 20 {
            println!("  ... and {} more", plan.scenarios.len() - 20);
        }
        
        println!("\n✨ Next step: run 'rohan build {:?} --e2e' to generate E2E test scripts", args.output);
    } else {
        println!("   {} test entries for {} (v{})", plan.tests.len(), plan.api_title, plan.api_version);

        println!("\n📝 Test entries:");
        for (i, test) in plan.tests.iter().enumerate().take(20) {
            println!("  {}. {} ({} {})", i + 1, test.name, test.method, test.path);
        }
        if plan.tests.len() > 20 {
            println!("  ... and {} more", plan.tests.len() - 20);
        }

        println!("\n✨ Next step: run 'rohan build {:?}' to generate test scripts", args.output);
    }
    Ok(())
}

/// Build test scripts from a test plan JSON file
pub fn build_from_plan(args: &BuildArgs) -> Result<()> {
    // 1. Load test plan
    println!("📖 Loading test plan from {:?}...", args.plan_path);
    let plan = TestPlan::load(&args.plan_path)?;
    
    println!("✅ Loaded plan for {} (v{})", plan.api_title, plan.api_version);
    
    // Check if plan mode matches CLI flag
    if plan.e2e != args.e2e {
        if plan.e2e {
            println!("⚠️  This is an E2E test plan. Add --e2e flag to build command.");
        } else {
            println!("⚠️  This is a unit test plan. Remove --e2e flag from build command.");
        }
    }
    
    if plan.e2e {
        println!("   {} E2E scenarios", plan.scenarios.len());
    } else {
        println!("   {} test entries", plan.tests.len());
    }

    // 2. Create output directory
    fs::create_dir_all(&args.output)?;

    // 3. Create callback to write files incrementally as they're generated
    let output_dir = args.output.clone();
    let overwrite = args.overwrite;
    
    // Track manifest entries as files are written
    let manifest_entries: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
    let manifest_entries_clone = Arc::clone(&manifest_entries);
    let counter = Arc::new(Mutex::new(0usize));
    let counter_clone = Arc::clone(&counter);

    let write_callback: ScriptCallback = Box::new(move |test_name: &str, code: &str| {
        let filename = test_name_to_filename(test_name);
        let file_path = output_dir.join(&filename);
        
        // Increment counter and get ID
        let mut cnt = counter_clone.lock().unwrap();
        *cnt += 1;
        let id = *cnt;
        
        // Add to manifest
        {
            let mut entries = manifest_entries_clone.lock().unwrap();
            entries.push(serde_json::json!({
                "id": id,
                "name": test_name,
                "file": filename
            }));
        }
        
        // Check if file exists and handle overwrite flag
        if file_path.exists() && !overwrite {
            return Ok(false); // Skipped
        }
        
        let content = format!("// Test: {}\n// Generated by Rohan\n\n{}", test_name, code);
        fs::write(&file_path, content)?;
        Ok(true) // Written
    });

    // 4. Generate test scripts (files are written incrementally via callback)
    let script_type = if plan.e2e { "E2E test scripts" } else { "test scripts" };
    println!("\n🏗️  Generating {} with LLM ({}) ...", script_type, args.model);
    let _test_scripts = build_scripts_from_plan(
        &plan,
        args.api_base.as_deref(),
        &args.model,
        args.prompt_dir.clone(),
        args.workers,
        args.rpm,
        args.batch_size,
        Some(write_callback),
    )?;

    // 5. Write manifest at the end
    let manifest_path = args.output.join("manifest.json");
    let manifest = manifest_entries.lock().unwrap();
    fs::write(&manifest_path, serde_json::to_string_pretty(&*manifest)?)?;
    println!("\n📄 Wrote manifest to {:?} ({} entries)", manifest_path, manifest.len());

    // Print k6 run instructions
    let tests_path = args.output.display();
    println!("\n🚀 Run tests with k6:");
    println!("   # Run a single test:");
    println!("   k6 run --env BASE_URL=http://localhost:8080 {}/test_get_message_basic.js", tests_path);
    println!();
    println!("   # Run all tests:");
    println!("   for f in {}/*.js; do k6 run --env BASE_URL=http://localhost:8080 \"$f\"; done", tests_path);
    println!();
    println!("   # Or on Windows PowerShell:");
    println!("   Get-ChildItem {}\\*.js | ForEach-Object {{ k6 run --env BASE_URL=http://localhost:8080 $_.FullName }}", tests_path);
    
    Ok(())
}

/// Show instructions for executing test scripts with k6
pub fn exec_tests(args: &ExecArgs) -> Result<()> {
    // Load manifest to count tests
    let manifest_path = args.tests_dir.join("manifest.json");
    let manifest_content = fs::read_to_string(&manifest_path)
        .with_context(|| format!("Failed to read manifest at {:?}", manifest_path))?;

    let manifest: Vec<serde_json::Value> = serde_json::from_str(&manifest_content)?;
    let test_count = manifest.len();

    let tests_path = args.tests_dir.display();
    let target = args.target.as_deref().unwrap_or("http://localhost:8080");

    println!("📋 Found {} k6 test scripts in {:?}", test_count, args.tests_dir);
    println!();
    println!("🚀 To run these tests, use k6:");
    println!();
    println!("   # Run a single test:");
    println!("   k6 run --env BASE_URL={} {}/test_1.js", target, tests_path);
    println!();
    println!("   # Run all tests (bash/zsh):");
    println!("   for f in {}/*.js; do k6 run --env BASE_URL={} \"$f\"; done", tests_path, target);
    println!();
    println!("   # Run all tests (PowerShell):");
    println!("   Get-ChildItem {}\\*.js | ForEach-Object {{ k6 run --env BASE_URL={} $_.FullName }}", tests_path, target);
    println!();
    println!("📦 Install k6: https://k6.io/docs/get-started/installation/");
    println!("   - Windows: choco install k6  OR  winget install k6");
    println!("   - macOS:   brew install k6");
    println!("   - Linux:   See k6.io for your distro");

    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    // ============================================
    // validate_spec Tests
    // ============================================

    fn create_temp_spec_file(content: &str) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(content.as_bytes()).unwrap();
        file.flush().unwrap();
        file
    }

    #[test]
    fn test_validate_spec_minimal() {
        let spec = r#"{
            "openapi": "3.0.0",
            "info": {
                "title": "Test API",
                "version": "1.0.0"
            },
            "paths": {}
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_ok());
        let api = result.unwrap();
        assert_eq!(api.info.title, "Test API");
        assert_eq!(api.info.version, "1.0.0");
    }

    #[test]
    fn test_validate_spec_with_paths() {
        let spec = r#"{
            "openapi": "3.0.0",
            "info": {
                "title": "API with Paths",
                "version": "2.0.0"
            },
            "paths": {
                "/users": {
                    "get": {
                        "responses": {
                            "200": {"description": "Success"}
                        }
                    }
                },
                "/health": {
                    "get": {
                        "responses": {
                            "200": {"description": "OK"}
                        }
                    }
                }
            }
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_ok());
        let api = result.unwrap();
        assert_eq!(api.paths.paths.len(), 2);
    }

    #[test]
    fn test_validate_spec_invalid_json() {
        let spec = "{ not valid json }";
        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to parse"));
    }

    #[test]
    fn test_validate_spec_missing_required_fields() {
        let spec = r#"{
            "openapi": "3.0.0"
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        // Missing "info" should cause parsing error
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_spec_file_not_found() {
        let path = PathBuf::from("/nonexistent/path/to/spec.json");
        let result = validate_spec(&path);

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to read"));
    }

    #[test]
    fn test_validate_spec_empty_file() {
        let file = create_temp_spec_file("");
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_err());
    }

    #[test]
    fn test_validate_spec_complex() {
        let spec = r#"{
            "openapi": "3.0.0",
            "info": {
                "title": "Complex API",
                "version": "3.0.0",
                "description": "A complex API specification"
            },
            "servers": [
                {"url": "https://api.example.com/v1"}
            ],
            "paths": {
                "/users": {
                    "get": {
                        "summary": "List users",
                        "responses": {
                            "200": {
                                "description": "Success",
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "array",
                                            "items": {"type": "object"}
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "post": {
                        "summary": "Create user",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": {"type": "object"}
                                }
                            }
                        },
                        "responses": {
                            "201": {"description": "Created"}
                        }
                    }
                },
                "/users/{id}": {
                    "get": {
                        "summary": "Get user by ID",
                        "parameters": [
                            {
                                "name": "id",
                                "in": "path",
                                "required": true,
                                "schema": {"type": "string"}
                            }
                        ],
                        "responses": {
                            "200": {"description": "Success"},
                            "404": {"description": "Not found"}
                        }
                    }
                }
            }
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_ok());
        let api = result.unwrap();
        assert_eq!(api.info.title, "Complex API");
        assert_eq!(api.paths.paths.len(), 2);
    }

    #[test]
    fn test_validate_spec_with_components() {
        let spec = r#"{
            "openapi": "3.0.0",
            "info": {
                "title": "API with Components",
                "version": "1.0.0"
            },
            "paths": {},
            "components": {
                "schemas": {
                    "User": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "integer"},
                            "name": {"type": "string"}
                        }
                    }
                },
                "securitySchemes": {
                    "bearerAuth": {
                        "type": "http",
                        "scheme": "bearer"
                    }
                }
            }
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_spec_version_formats() {
        // Test OpenAPI 3.0.0
        let spec_300 = r#"{
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.0.0"},
            "paths": {}
        }"#;

        // Test OpenAPI 3.0.1
        let spec_301 = r#"{
            "openapi": "3.0.1",
            "info": {"title": "API", "version": "1.0.0"},
            "paths": {}
        }"#;

        // Test OpenAPI 3.0.3
        let spec_303 = r#"{
            "openapi": "3.0.3",
            "info": {"title": "API", "version": "1.0.0"},
            "paths": {}
        }"#;

        let file_300 = create_temp_spec_file(spec_300);
        let file_301 = create_temp_spec_file(spec_301);
        let file_303 = create_temp_spec_file(spec_303);

        assert!(validate_spec(&file_300.path().to_path_buf()).is_ok());
        assert!(validate_spec(&file_301.path().to_path_buf()).is_ok());
        assert!(validate_spec(&file_303.path().to_path_buf()).is_ok());
    }

    #[test]
    fn test_validate_spec_unicode_content() {
        let spec = r#"{
            "openapi": "3.0.0",
            "info": {
                "title": "国际化 API 🌍",
                "version": "1.0.0",
                "description": "API с описанием на разных языках"
            },
            "paths": {
                "/用户": {
                    "get": {
                        "summary": "获取用户列表",
                        "responses": {
                            "200": {"description": "成功"}
                        }
                    }
                }
            }
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_ok());
        let api = result.unwrap();
        assert!(api.info.title.contains("国际化"));
    }

    // ============================================
    // Edge Cases for Spec Validation
    // ============================================

    #[test]
    fn test_validate_spec_extra_fields() {
        let spec = r#"{
            "openapi": "3.0.0",
            "info": {
                "title": "API",
                "version": "1.0.0",
                "x-custom-field": "should be ignored"
            },
            "paths": {},
            "x-another-extension": {"key": "value"}
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        // Extra fields should be allowed (OpenAPI supports x- extensions)
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_spec_all_http_methods() {
        let spec = r#"{
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.0.0"},
            "paths": {
                "/resource": {
                    "get": {"responses": {"200": {"description": "OK"}}},
                    "post": {"responses": {"201": {"description": "Created"}}},
                    "put": {"responses": {"200": {"description": "Updated"}}},
                    "delete": {"responses": {"204": {"description": "Deleted"}}},
                    "patch": {"responses": {"200": {"description": "Patched"}}},
                    "options": {"responses": {"200": {"description": "Options"}}},
                    "head": {"responses": {"200": {"description": "Head"}}}
                }
            }
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_spec_with_tags() {
        let spec = r#"{
            "openapi": "3.0.0",
            "info": {"title": "API", "version": "1.0.0"},
            "tags": [
                {"name": "users", "description": "User operations"},
                {"name": "items", "description": "Item operations"}
            ],
            "paths": {
                "/users": {
                    "get": {
                        "tags": ["users"],
                        "responses": {"200": {"description": "OK"}}
                    }
                }
            }
        }"#;

        let file = create_temp_spec_file(spec);
        let result = validate_spec(&file.path().to_path_buf());

        assert!(result.is_ok());
    }

    // ============================================
    // test_name_to_filename Tests
    // ============================================

    #[test]
    fn test_name_to_filename_basic() {
        assert_eq!(
            test_name_to_filename("Get_Message_Basic"),
            "test_get_message_basic.js"
        );
    }

    #[test]
    fn test_name_to_filename_with_spaces() {
        assert_eq!(
            test_name_to_filename("Get Message With Spaces"),
            "test_get_message_with_spaces.js"
        );
    }

    #[test]
    fn test_name_to_filename_mixed_case() {
        assert_eq!(
            test_name_to_filename("GetUserById"),
            "test_getuserbyid.js"
        );
    }

    #[test]
    fn test_name_to_filename_special_chars() {
        assert_eq!(
            test_name_to_filename("Test: API/Endpoint (v2)"),
            "test_test_api_endpoint_v2.js"
        );
    }

    #[test]
    fn test_name_to_filename_multiple_underscores() {
        assert_eq!(
            test_name_to_filename("Test___Multiple___Underscores"),
            "test_test_multiple_underscores.js"
        );
    }

    #[test]
    fn test_name_to_filename_leading_special_chars() {
        assert_eq!(
            test_name_to_filename("---Test Name---"),
            "test_test_name.js"
        );
    }

    #[test]
    fn test_name_to_filename_numbers() {
        assert_eq!(
            test_name_to_filename("Test_123_Numbers"),
            "test_test_123_numbers.js"
        );
    }
}

