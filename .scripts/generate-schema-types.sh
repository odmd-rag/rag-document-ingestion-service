#!/bin/bash

# EventBridge Schema Type Generator
# 
# OndemandEnv Architecture Highlight: Leverage Cloud Capabilities
# Rather than manually maintaining TypeScript interfaces, we use EventBridge 
# Schema Registry's native code generation capabilities to automatically 
# generate type-safe interfaces for our Lambda functions.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text 2>/dev/null)}
AWS_REGION=${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-2")}
SCHEMA_REGISTRY_NAME="rag-document-schemas-${AWS_ACCOUNT_ID}-${AWS_REGION}"
OUTPUT_DIR="../lib/generated/eventbridge-types"
TEMP_DIR="/tmp/eventbridge-schemas-$$"

# Schema names that match our EventBridge Schema Registry
SCHEMAS=(
    "rag.document-ingestion.DocumentValidated"
    "rag.document-ingestion.DocumentRejected"
    "rag.document-ingestion.DocumentQuarantined"
)

# Utility functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed. Please install AWS CLI first."
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed. Please install jq for JSON processing."
        exit 1
    fi
    
    if [[ -z "$AWS_ACCOUNT_ID" ]]; then
        log_error "AWS_ACCOUNT_ID not found. Please set AWS_ACCOUNT_ID environment variable or configure AWS CLI."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
    log_info "AWS Account: $AWS_ACCOUNT_ID"
    log_info "AWS Region: $AWS_REGION"
    log_info "Schema Registry: $SCHEMA_REGISTRY_NAME"
}

# Setup output directory
setup_output_dir() {
    log_info "Setting up output directory..."
    
    mkdir -p "$OUTPUT_DIR"
    mkdir -p "$TEMP_DIR"
    
    log_success "Output directory ready: $OUTPUT_DIR"
}

# Fetch schema from EventBridge Schema Registry
fetch_schema() {
    local schema_name=$1
    local output_file=$2
    
    log_info "Fetching schema: $schema_name"
    
    if aws schemas describe-schema \
        --registry-name "$SCHEMA_REGISTRY_NAME" \
        --schema-name "$schema_name" \
        --region "$AWS_REGION" \
        --output json > "$output_file" 2>/dev/null; then
        
        log_success "Schema fetched: $schema_name"
        return 0
    else
        log_error "Failed to fetch schema: $schema_name"
        log_error "Make sure the schema exists in registry: $SCHEMA_REGISTRY_NAME"
        return 1
    fi
}

# Generate TypeScript interface from JSON schema
generate_interface() {
    local schema_file=$1
    local interface_name=$2
    
    local schema_content
    schema_content=$(jq -r '.Content' "$schema_file")
    
    if [[ "$schema_content" == "null" ]]; then
        log_error "No schema content found in $schema_file"
        return 1
    fi
    
    # Extract detail properties
    local detail_properties
    detail_properties=$(echo "$schema_content" | jq -r '.properties.detail.properties // empty')
    
    if [[ -z "$detail_properties" || "$detail_properties" == "null" ]]; then
        log_warn "No detail properties found for $interface_name"
        return 1
    fi
    
    # Generate TypeScript interface
    cat << EOF

// Schema: $(jq -r '.SchemaName' "$schema_file") (v$(jq -r '.SchemaVersion' "$schema_file"))
// Description: $(jq -r '.Description // "No description"' "$schema_file")
export interface ${interface_name}Detail {
EOF
    
    # Process each property
    echo "$detail_properties" | jq -r 'to_entries[] | "\(.key): \(.value)"' | while read -r prop; do
        local key
        local value
        key=$(echo "$prop" | cut -d: -f1)
        value=$(echo "$prop" | cut -d: -f2-)
        
        local ts_type
        ts_type=$(get_typescript_type "$value")
        
        # Check if property is required
        local required_props
        required_props=$(echo "$schema_content" | jq -r '.properties.detail.required[]? // empty')
        
        local optional=""
        if ! echo "$required_props" | grep -q "^${key}$"; then
            optional="?"
        fi
        
        echo "  ${key}${optional}: ${ts_type};"
    done
    
    echo "}"
    
    # Generate event type
    local detail_type
    detail_type=$(echo "$schema_content" | jq -r '.properties["detail-type"].enum[0] // "Unknown"')
    
    echo ""
    echo "export type ${interface_name}Event = EventBridgeEvent<'${detail_type}', ${interface_name}Detail>;"
}

# Convert JSON Schema type to TypeScript type
get_typescript_type() {
    local schema_prop=$1
    local type
    type=$(echo "$schema_prop" | jq -r '.type')
    
    case "$type" in
        "string")
            local enum_values
            enum_values=$(echo "$schema_prop" | jq -r '.enum[]? // empty' 2>/dev/null)
            if [[ -n "$enum_values" ]]; then
                echo "$enum_values" | sed "s/^/'/" | sed "s/$/'/" | tr '\n' '|' | sed 's/|$//'
            else
                echo "string"
            fi
            ;;
        "number"|"integer")
            echo "number"
            ;;
        "boolean")
            echo "boolean"
            ;;
        "object")
            echo "Record<string, any>"
            ;;
        "array")
            echo "any[]"
            ;;
        *)
            echo "any"
            ;;
    esac
}

# Generate TypeScript code bindings using AWS CLI
generate_aws_code_bindings() {
    local schema_name=$1
    local interface_name=$2
    
    log_info "Generating AWS code bindings for: $schema_name"
    
    # Try to get code bindings from AWS
    if aws schemas get-code-binding-source \
        --registry-name "$SCHEMA_REGISTRY_NAME" \
        --schema-name "$schema_name" \
        --language "TypeScript" \
        --region "$AWS_REGION" \
        --query 'Body' \
        --output text > "$OUTPUT_DIR/${interface_name}.binding.ts" 2>/dev/null; then
        
        log_success "AWS code binding generated: ${interface_name}.binding.ts"
    else
        log_warn "AWS code binding not available for: $schema_name"
        # Create a placeholder binding file
        cat > "$OUTPUT_DIR/${interface_name}.binding.ts" << EOF
// AWS Code Binding not available for $schema_name
// Using custom-generated interface instead
export * from './index';
EOF
    fi
}

# Generate main TypeScript types file
generate_main_types_file() {
    log_info "Generating main TypeScript types file..."
    
    local output_file="$OUTPUT_DIR/index.ts"
    
    # File header
    cat > "$output_file" << EOF
// Auto-generated TypeScript interfaces from EventBridge Schema Registry
// Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
// Registry: $SCHEMA_REGISTRY_NAME
//
// OndemandEnv Architecture: These types are automatically generated from 
// EventBridge Schema Registry, ensuring contract compliance across services.
// DO NOT EDIT MANUALLY - Run '.scripts/generate-schema-types.sh' to regenerate.

import { EventBridgeEvent } from 'aws-lambda';
EOF
    
    # Generate interfaces for each schema
    for schema_name in "${SCHEMAS[@]}"; do
        local interface_name
        interface_name=$(echo "$schema_name" | sed 's/.*\.//')
        
        local schema_file="$TEMP_DIR/${interface_name}.json"
        
        if fetch_schema "$schema_name" "$schema_file"; then
            generate_interface "$schema_file" "$interface_name" >> "$output_file"
            generate_aws_code_bindings "$schema_name" "$interface_name"
        fi
    done
    
    # Add utility types
    cat >> "$output_file" << 'EOF'

// Utility types for EventBridge event handling
export type RAGEventTypes = 
  | DocumentValidatedEvent 
  | DocumentRejectedEvent 
  | DocumentQuarantinedEvent;

// Type guards for runtime type checking
export function isDocumentValidatedEvent(event: any): event is DocumentValidatedEvent {
  return event['detail-type'] === 'Document Validated';
}

export function isDocumentRejectedEvent(event: any): event is DocumentRejectedEvent {
  return event['detail-type'] === 'Document Rejected';
}

export function isDocumentQuarantinedEvent(event: any): event is DocumentQuarantinedEvent {
  return event['detail-type'] === 'Document Quarantined';
}

// Event handler type definitions
export type DocumentValidatedHandler = (event: DocumentValidatedEvent) => Promise<void>;
export type DocumentRejectedHandler = (event: DocumentRejectedEvent) => Promise<void>;
export type DocumentQuarantinedHandler = (event: DocumentQuarantinedEvent) => Promise<void>;

// Generic event handler type
export type RAGEventHandler<T extends RAGEventTypes> = (event: T) => Promise<void>;
EOF
    
    log_success "Main types file generated: $output_file"
}

# Cleanup
cleanup() {
    if [[ -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
    fi
}

# Main execution
main() {
    echo "🚀 EventBridge Schema Type Generation Started"
    echo "================================================"
    
    # Setup trap for cleanup
    trap cleanup EXIT
    
    # Execute steps
    check_prerequisites
    setup_output_dir
    generate_main_types_file
    
    echo ""
    echo "🎉 Schema type generation completed successfully!"
    echo "📄 Generated files in: $OUTPUT_DIR"
    echo ""
    echo "💡 Usage in Lambda functions:"
    echo "   import { DocumentValidatedEvent, DocumentValidatedHandler } from './generated/eventbridge-types';"
    echo ""
    echo "🔄 To regenerate types after schema changes:"
    echo "   cd .scripts && ./generate-schema-types.sh"
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi 