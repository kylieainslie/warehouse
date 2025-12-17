#!/bin/bash
# Setup script for The Warehouse project

echo "🏗️  Setting up The Warehouse..."

# Create directory structure
echo "Creating directories..."
mkdir -p data/{raw,processed}
mkdir -p scripts
mkdir -p website/{packages,categories}

# Create placeholder files
touch data/.gitkeep
touch data/raw/.gitkeep
touch data/processed/.gitkeep

# Create .gitignore
cat > .gitignore << 'EOF'
# R
.Rproj.user
.Rhistory
.RData
.Ruserdata

# Data (large files)
data/raw/*
data/processed/*
!data/**/.gitkeep

# Quarto
/.quarto/
/_site/

# OS
.DS_Store
Thumbs.db

# Secrets
.Renviron
.env
EOF

# Create .Rproj file
cat > warehouse.Rproj << 'EOF'
Version: 1.0

RestoreWorkspace: Default
SaveWorkspace: Default
AlwaysSaveHistory: Default

EnableCodeIndexing: Yes
UseSpacesForTab: Yes
NumSpacesForTab: 2
Encoding: UTF-8

RnwWeave: Sweave
LaTeX: pdfLaTeX
EOF

echo "✅ Directory structure created"
echo "✅ .gitignore created"
echo "✅ RStudio project file created"
echo ""
echo "📦 Next steps:"
echo "1. Copy website files to website/ directory"
echo "2. Open warehouse.Rproj in RStudio"
echo "3. Run: cd website && quarto preview"
echo ""
echo "🎉 Setup complete!"
