# CIL-RCC Storage Tracker

> A full-stack storage analytics platform for analyzing filesystem snapshots from the UChicago RCC cluster.

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 📊 Overview

This tool provides interactive analytics and visualization for large-scale filesystem scans, enabling users to:
- 🔍 Explore storage usage patterns across 40M+ files
- 📈 Identify large files and directories
- 📊 Analyze file type distributions
- 🕒 Track changes over time with snapshot comparisons

## ✨ Features

- **Interactive Dashboard**: Browse filesystem hierarchy with tree navigation
- **Analytics**: Heavy files, file type breakdown, directory statistics
- **High Performance**: DuckDB queries on parquet files without loading into memory
- **Environment Auto-Detection**: Works seamlessly on cluster or local Mac
- **Snapshot Management**: Compare multiple time points

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/cil-rcc-storage-tracker.git
cd cil-rcc-storage-tracker

# Start backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Start frontend (in new terminal)
cd frontend
npm install
npm run dev

# Open browser: http://localhost:3001/dashboard/2025-12-13
```

## 📚 Documentation

- **[CLAUDE.md](CLAUDE.md)** - Complete project documentation, setup, and usage
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Cloud deployment guide (Hugging Face + Vercel)
- **[PROJECT_STATUS.md](PROJECT_STATUS.md)** - Current status and roadmap

## 🏗️ Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Frontend  │─────▶│   Backend   │─────▶│   DuckDB    │
│  (Next.js)  │      │  (FastAPI)  │      │  (Parquet)  │
└─────────────┘      └─────────────┘      └─────────────┘
     Web UI          REST API           Query Engine
```

## 🛠️ Tech Stack

**Frontend**:
- Next.js 14 (App Router)
- React Query (TanStack Query)
- Radix UI Components
- Tailwind CSS

**Backend**:
- FastAPI
- DuckDB
- PyArrow (Parquet)
- Polars (DataFrames)

**Data Pipeline**:
- Scanner (Rust-based filesystem scanner)
- Python aggregation scripts

## 📦 Project Structure

```
cil-rcc-storage-tracker/
├── backend/          # FastAPI backend
│   ├── app/          # Application code
│   └── scripts/      # Data processing scripts
├── frontend/         # Next.js frontend
│   ├── app/          # Pages and layouts
│   ├── components/   # React components
│   └── lib/          # Utilities and hooks
└── scanner/          # Cluster-side scanning tools
```

## 🚢 Deployment

Currently running locally. Cloud deployment planned for:
- **Frontend**: Vercel (free tier)
- **Database**: Hugging Face Datasets (free tier)
- **Cost**: $0-9/month

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment guide.

## 🗺️ Roadmap

### Phase 1: Local Development ✅
- [x] Backend with DuckDB
- [x] Frontend dashboard
- [x] Environment auto-detection

### Phase 2: Cloud Deployment 🚧
- [ ] DuckDB on Hugging Face
- [ ] Frontend on Vercel
- [ ] GitHub Actions automation

### Phase 3: Production Features 🔮
- [ ] Historical comparisons
- [ ] Growth trend analytics
- [ ] Multi-user authentication
- [ ] Custom reports

## 📋 Requirements

- Python 3.10+
- Node.js 18+
- Access to UChicago RCC cluster (for data)

## 🤝 Contributing

This project is currently in active development. For questions or issues, please contact the maintainer.

## 📄 License

See [LICENSE](LICENSE) file for details.

## 👤 Author

**Sebastian Cadavid Sanchez**
- GitHub: [@scadavidsanchez](https://github.com/scadavidsanchez)

## 🙏 Acknowledgments

- UChicago Research Computing Center
- Climate Impact Lab
- Scanner filesystem tool

---

**Status**: Active Development | **Last Updated**: 2025-12-12
