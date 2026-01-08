//! Rohan - OpenAPI Test Generator for k6
//!
//! A CLI tool that generates k6 JavaScript test scripts
//! from OpenAPI specifications using LLMs.

mod cli;
mod commands;
mod config;
mod generator;

use anyhow::Result;
use clap::Parser;
use cli::{Cli, Commands};
use commands::{build_from_plan, exec_tests, generate_plan, validate_spec};

fn main() -> Result<()> {
    // Load .env file before parsing CLI args so env vars are available
    if let Err(e) = dotenvy::dotenv() {
        // Only show error if .env exists but failed to load
        if std::path::Path::new(".env").exists() {
            eprintln!("⚠️  Warning: Failed to load .env file: {}", e);
        }
    }
    
    let cli = Cli::parse();

    match &cli.command {
        Commands::Plan(args) => {
            if args.verbose {
                println!("DEBUG: LLM API Base: {:?}", args.api_base);
                println!("DEBUG: LLM Model: {}", args.model);
            }
            println!("📐 Generating test plan...");
            if let Err(e) = generate_plan(args) {
                eprintln!("❌ Error: {}", e);
                std::process::exit(1);
            }
        }
        Commands::Build(args) => {
            if args.verbose {
                println!("DEBUG: LLM API Base: {:?}", args.api_base);
                println!("DEBUG: LLM Model: {}", args.model);
            }
            println!("🏗️  Building k6 test scripts from plan...");
            if let Err(e) = build_from_plan(args) {
                eprintln!("❌ Error: {}", e);
                std::process::exit(1);
            }
        }
        Commands::Exec(args) => {
            if let Err(e) = exec_tests(args) {
                eprintln!("❌ Error: {}", e);
                std::process::exit(1);
            }
        }
        Commands::Validate(args) => {
            println!("🔍 Validating OpenAPI spec: {:?}", args.spec_path);
            if let Err(e) = validate_spec(&args.spec_path) {
                eprintln!("❌ Validation failed: {}", e);
                std::process::exit(1);
            }
            println!("✅ Spec is valid!");
        }
    }

    Ok(())
}
