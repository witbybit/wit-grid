import React, { useState, useMemo, useCallback } from 'react';
import {
	Grid,
	type ColumnDef,
	type CellRendererProps,
	type GridApi,
	type GridReadyEvent,
	GridInitialState,
	StyleRule,
} from '@eregister/wit-grid-react';
import {
	Building2,
	ChevronRight,
	ChevronDown,
	FileText,
	Plus,
	ExternalLink,
	Search,
	AlertCircle,
	CheckCircle2,
	XCircle,
	BarChart3,
	MapPin,
	Clock,
	Filter,
	ArrowUpDown,
	Info,
	Layers,
	TrendingUp,
	ShieldCheck,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface ProjectRow {
	id: string;
	name: string;
	status: 'ONGOING' | 'COMPLETED' | 'PAUSED' | 'PLANNING';
	location: string;
	subprojectCount: number | null;
	establishmentCount: number | null;
	compliance: number;
	critical: number;
	warnings: number;
	parentId?: string;
}

// ============================================================================
// Data
// ============================================================================

const ALL_ROWS: ProjectRow[] = [
	// 1. New Project VA
	{
		id: 'p1',
		name: 'New Project VA',
		status: 'ONGOING',
		location: 'Delhi NCR',
		subprojectCount: 3,
		establishmentCount: 8,
		compliance: 87,
		critical: 2,
		warnings: 3,
	},
	{
		id: 'p1-s1',
		name: 'Phase 1',
		status: 'ONGOING',
		location: 'Delhi',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 82,
		critical: 2,
		warnings: 3,
		parentId: 'p1',
	},
	{
		id: 'p1-s2',
		name: 'test',
		status: 'ONGOING',
		location: 'test',
		subprojectCount: null,
		establishmentCount: 1,
		compliance: 100,
		critical: 0,
		warnings: 0,
		parentId: 'p1',
	},
	{
		id: 'p1-s3',
		name: 'Test Complete',
		status: 'COMPLETED',
		location: 'Kolkata',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 93,
		critical: 0,
		warnings: 1,
		parentId: 'p1',
	},

	// 2. Test Project
	{
		id: 'p2',
		name: 'Test Project',
		status: 'ONGOING',
		location: 'Multiple',
		subprojectCount: 2,
		establishmentCount: 7,
		compliance: 94,
		critical: 0,
		warnings: 0,
	},
	{
		id: 'p2-s1',
		name: 'Infrastructure Upgrade',
		status: 'ONGOING',
		location: 'Mumbai',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 96,
		critical: 0,
		warnings: 0,
		parentId: 'p2',
	},
	{
		id: 'p2-s2',
		name: 'Safety Protocol Review',
		status: 'COMPLETED',
		location: 'Pune',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 91,
		critical: 0,
		warnings: 0,
		parentId: 'p2',
	},

	// 3. Green Valley Industrial
	{
		id: 'p3',
		name: 'Green Valley Industrial',
		status: 'ONGOING',
		location: 'Bengaluru',
		subprojectCount: 5,
		establishmentCount: 14,
		compliance: 76,
		critical: 3,
		warnings: 5,
	},
	{
		id: 'p3-s1',
		name: 'Manufacturing Unit A',
		status: 'ONGOING',
		location: 'Bengaluru North',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 68,
		critical: 2,
		warnings: 3,
		parentId: 'p3',
	},
	{
		id: 'p3-s2',
		name: 'Manufacturing Unit B',
		status: 'ONGOING',
		location: 'Mysuru',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 85,
		critical: 1,
		warnings: 1,
		parentId: 'p3',
	},
	{
		id: 'p3-s3',
		name: 'Warehouse Complex',
		status: 'ONGOING',
		location: 'Bengaluru East',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 71,
		critical: 0,
		warnings: 2,
		parentId: 'p3',
	},
	{
		id: 'p3-s4',
		name: 'Admin & Corporate Block',
		status: 'ONGOING',
		location: 'Bengaluru Central',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 82,
		critical: 0,
		warnings: 1,
		parentId: 'p3',
	},
	{
		id: 'p3-s5',
		name: 'Utilities & Power Hub',
		status: 'PLANNING',
		location: 'Tumkur',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 77,
		critical: 0,
		warnings: 2,
		parentId: 'p3',
	},

	// 4. Northern Rail Corridor
	{
		id: 'p4',
		name: 'Northern Rail Corridor',
		status: 'ONGOING',
		location: 'Chandigarh',
		subprojectCount: 6,
		establishmentCount: 18,
		compliance: 91,
		critical: 0,
		warnings: 2,
	},
	{
		id: 'p4-s1',
		name: 'Track Laying Section A',
		status: 'COMPLETED',
		location: 'Ambala',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 98,
		critical: 0,
		warnings: 0,
		parentId: 'p4',
	},
	{
		id: 'p4-s2',
		name: 'Track Laying Section B',
		status: 'ONGOING',
		location: 'Ludhiana',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 94,
		critical: 0,
		warnings: 1,
		parentId: 'p4',
	},
	{
		id: 'p4-s3',
		name: 'Station Rehabilitation',
		status: 'ONGOING',
		location: 'Chandigarh',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 88,
		critical: 0,
		warnings: 1,
		parentId: 'p4',
	},
	{
		id: 'p4-s4',
		name: 'Bridge & Overpass Works',
		status: 'ONGOING',
		location: 'Jalandhar',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 91,
		critical: 0,
		warnings: 0,
		parentId: 'p4',
	},
	{
		id: 'p4-s5',
		name: 'Electrification Phase I',
		status: 'ONGOING',
		location: 'Pathankot',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 86,
		critical: 0,
		warnings: 1,
		parentId: 'p4',
	},
	{
		id: 'p4-s6',
		name: 'Signalling & Telecoms',
		status: 'PLANNING',
		location: 'Amritsar',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 79,
		critical: 0,
		warnings: 0,
		parentId: 'p4',
	},

	// 5. Coastal Highway Project
	{
		id: 'p5',
		name: 'Coastal Highway Project',
		status: 'ONGOING',
		location: 'Chennai',
		subprojectCount: 4,
		establishmentCount: 12,
		compliance: 89,
		critical: 1,
		warnings: 2,
	},
	{
		id: 'p5-s1',
		name: 'NH-32 Realignment',
		status: 'ONGOING',
		location: 'Pondicherry',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 88,
		critical: 0,
		warnings: 1,
		parentId: 'p5',
	},
	{
		id: 'p5-s2',
		name: 'Port Access Road',
		status: 'ONGOING',
		location: 'Chennai Port',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 83,
		critical: 1,
		warnings: 1,
		parentId: 'p5',
	},
	{
		id: 'p5-s3',
		name: 'Flyover Construction',
		status: 'COMPLETED',
		location: 'Mahabalipuram',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 97,
		critical: 0,
		warnings: 0,
		parentId: 'p5',
	},
	{
		id: 'p5-s4',
		name: 'Drainage & Safety Barriers',
		status: 'ONGOING',
		location: 'Cuddalore',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 91,
		critical: 0,
		warnings: 1,
		parentId: 'p5',
	},

	// 6. Smart City Hyderabad
	{
		id: 'p6',
		name: 'Smart City Hyderabad',
		status: 'ONGOING',
		location: 'Hyderabad',
		subprojectCount: 7,
		establishmentCount: 22,
		compliance: 95,
		critical: 0,
		warnings: 1,
	},
	{
		id: 'p6-s1',
		name: 'Digital Infrastructure',
		status: 'ONGOING',
		location: 'Hitech City',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 97,
		critical: 0,
		warnings: 0,
		parentId: 'p6',
	},
	{
		id: 'p6-s2',
		name: 'Smart Traffic System',
		status: 'ONGOING',
		location: 'Jubilee Hills',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 95,
		critical: 0,
		warnings: 0,
		parentId: 'p6',
	},
	{
		id: 'p6-s3',
		name: 'Public Wi-Fi Grid',
		status: 'COMPLETED',
		location: 'Banjara Hills',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 100,
		critical: 0,
		warnings: 0,
		parentId: 'p6',
	},
	{
		id: 'p6-s4',
		name: 'Waste Management IoT',
		status: 'ONGOING',
		location: 'Secunderabad',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 91,
		critical: 0,
		warnings: 1,
		parentId: 'p6',
	},
	{
		id: 'p6-s5',
		name: 'Solar Street Lighting',
		status: 'ONGOING',
		location: 'LB Nagar',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 94,
		critical: 0,
		warnings: 0,
		parentId: 'p6',
	},
	{
		id: 'p6-s6',
		name: 'Command & Control Center',
		status: 'COMPLETED',
		location: 'Begumpet',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 98,
		critical: 0,
		warnings: 0,
		parentId: 'p6',
	},
	{
		id: 'p6-s7',
		name: 'Emergency Response Grid',
		status: 'PLANNING',
		location: 'Shamshabad',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 88,
		critical: 0,
		warnings: 0,
		parentId: 'p6',
	},

	// 7. Western Metro Extension
	{
		id: 'p7',
		name: 'Western Metro Extension',
		status: 'PAUSED',
		location: 'Ahmedabad',
		subprojectCount: 3,
		establishmentCount: 9,
		compliance: 72,
		critical: 4,
		warnings: 6,
	},
	{
		id: 'p7-s1',
		name: 'Underground Tunnel Phase I',
		status: 'PAUSED',
		location: 'Vastrapur',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 65,
		critical: 3,
		warnings: 4,
		parentId: 'p7',
	},
	{
		id: 'p7-s2',
		name: 'Elevated Track Section',
		status: 'PAUSED',
		location: 'Satellite',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 74,
		critical: 1,
		warnings: 2,
		parentId: 'p7',
	},
	{
		id: 'p7-s3',
		name: 'Station Fit-Out',
		status: 'PLANNING',
		location: 'Bopal',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 81,
		critical: 0,
		warnings: 1,
		parentId: 'p7',
	},

	// 8. Eastern Industrial Corridor
	{
		id: 'p8',
		name: 'Eastern Industrial Corridor',
		status: 'ONGOING',
		location: 'Bhubaneswar',
		subprojectCount: 5,
		establishmentCount: 15,
		compliance: 83,
		critical: 1,
		warnings: 3,
	},
	{
		id: 'p8-s1',
		name: 'SEZ Phase I Development',
		status: 'ONGOING',
		location: 'Cuttack',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 81,
		critical: 1,
		warnings: 2,
		parentId: 'p8',
	},
	{
		id: 'p8-s2',
		name: 'Industrial Park B',
		status: 'ONGOING',
		location: 'Paradip',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 87,
		critical: 0,
		warnings: 1,
		parentId: 'p8',
	},
	{
		id: 'p8-s3',
		name: 'Skill Development Center',
		status: 'COMPLETED',
		location: 'Bhubaneswar',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 96,
		critical: 0,
		warnings: 0,
		parentId: 'p8',
	},
	{
		id: 'p8-s4',
		name: 'Road Connectivity Grid',
		status: 'ONGOING',
		location: 'Jajpur',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 78,
		critical: 0,
		warnings: 1,
		parentId: 'p8',
	},
	{
		id: 'p8-s5',
		name: 'Port Logistics Hub',
		status: 'PLANNING',
		location: 'Dhamra',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 74,
		critical: 0,
		warnings: 0,
		parentId: 'p8',
	},

	// 9. Mumbai Coastal Road
	{
		id: 'p9',
		name: 'Mumbai Coastal Road',
		status: 'COMPLETED',
		location: 'Mumbai',
		subprojectCount: 4,
		establishmentCount: 16,
		compliance: 97,
		critical: 0,
		warnings: 0,
	},
	{
		id: 'p9-s1',
		name: 'Marine Drive Segment',
		status: 'COMPLETED',
		location: 'Marine Drive',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 98,
		critical: 0,
		warnings: 0,
		parentId: 'p9',
	},
	{
		id: 'p9-s2',
		name: 'Worli Sea Link Phase II',
		status: 'COMPLETED',
		location: 'Worli',
		subprojectCount: null,
		establishmentCount: 5,
		compliance: 97,
		critical: 0,
		warnings: 0,
		parentId: 'p9',
	},
	{
		id: 'p9-s3',
		name: 'Bandra Reclamation',
		status: 'COMPLETED',
		location: 'Bandra',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 96,
		critical: 0,
		warnings: 0,
		parentId: 'p9',
	},
	{
		id: 'p9-s4',
		name: 'Nariman Point Access',
		status: 'COMPLETED',
		location: 'South Mumbai',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 98,
		critical: 0,
		warnings: 0,
		parentId: 'p9',
	},

	// 10. Ganga Rejuvenation
	{
		id: 'p10',
		name: 'Ganga Rejuvenation',
		status: 'ONGOING',
		location: 'Varanasi',
		subprojectCount: 8,
		establishmentCount: 24,
		compliance: 85,
		critical: 1,
		warnings: 4,
	},
	{
		id: 'p10-s1',
		name: 'Sewage Treatment Plant I',
		status: 'ONGOING',
		location: 'Haridwar',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 88,
		critical: 0,
		warnings: 1,
		parentId: 'p10',
	},
	{
		id: 'p10-s2',
		name: 'Sewage Treatment Plant II',
		status: 'ONGOING',
		location: 'Kanpur',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 79,
		critical: 1,
		warnings: 2,
		parentId: 'p10',
	},
	{
		id: 'p10-s3',
		name: 'Ghat Restoration A',
		status: 'COMPLETED',
		location: 'Varanasi',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 95,
		critical: 0,
		warnings: 0,
		parentId: 'p10',
	},
	{
		id: 'p10-s4',
		name: 'Ghat Restoration B',
		status: 'ONGOING',
		location: 'Prayagraj',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 88,
		critical: 0,
		warnings: 1,
		parentId: 'p10',
	},
	{
		id: 'p10-s5',
		name: 'Riverbank Plantation',
		status: 'ONGOING',
		location: 'Patna',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 82,
		critical: 0,
		warnings: 1,
		parentId: 'p10',
	},
	{
		id: 'p10-s6',
		name: 'Industrial Effluent Control',
		status: 'ONGOING',
		location: 'Allahabad',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 77,
		critical: 0,
		warnings: 2,
		parentId: 'p10',
	},
	{
		id: 'p10-s7',
		name: 'Water Quality Monitoring',
		status: 'ONGOING',
		location: 'Mathura',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 91,
		critical: 0,
		warnings: 0,
		parentId: 'p10',
	},
	{
		id: 'p10-s8',
		name: 'Flood Control Embankment',
		status: 'PLANNING',
		location: 'Farrukhabad',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 84,
		critical: 0,
		warnings: 0,
		parentId: 'p10',
	},

	// 11. Rajasthan Solar Farm
	{
		id: 'p11',
		name: 'Rajasthan Solar Farm',
		status: 'ONGOING',
		location: 'Jaipur',
		subprojectCount: 3,
		establishmentCount: 10,
		compliance: 92,
		critical: 0,
		warnings: 1,
	},
	{
		id: 'p11-s1',
		name: 'Solar Array Block A',
		status: 'COMPLETED',
		location: 'Jodhpur',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 97,
		critical: 0,
		warnings: 0,
		parentId: 'p11',
	},
	{
		id: 'p11-s2',
		name: 'Transmission Line East',
		status: 'ONGOING',
		location: 'Bikaner',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 88,
		critical: 0,
		warnings: 1,
		parentId: 'p11',
	},
	{
		id: 'p11-s3',
		name: 'Grid Substation',
		status: 'ONGOING',
		location: 'Jaisalmer',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 91,
		critical: 0,
		warnings: 0,
		parentId: 'p11',
	},

	// 12. Chennai Water Recycling
	{
		id: 'p12',
		name: 'Chennai Water Recycling',
		status: 'ONGOING',
		location: 'Chennai',
		subprojectCount: 4,
		establishmentCount: 13,
		compliance: 88,
		critical: 0,
		warnings: 2,
	},
	{
		id: 'p12-s1',
		name: 'Desalination Plant A',
		status: 'ONGOING',
		location: 'Nemmeli',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 90,
		critical: 0,
		warnings: 1,
		parentId: 'p12',
	},
	{
		id: 'p12-s2',
		name: 'Recycled Water Pipeline',
		status: 'ONGOING',
		location: 'Perungudi',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 85,
		critical: 0,
		warnings: 1,
		parentId: 'p12',
	},
	{
		id: 'p12-s3',
		name: 'Reservoir Expansion',
		status: 'COMPLETED',
		location: 'Poondi',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 94,
		critical: 0,
		warnings: 0,
		parentId: 'p12',
	},
	{
		id: 'p12-s4',
		name: 'Distribution Network',
		status: 'PLANNING',
		location: 'Tambaram',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 82,
		critical: 0,
		warnings: 1,
		parentId: 'p12',
	},

	// 13. Andhra Petrochemicals Hub
	{
		id: 'p13',
		name: 'Andhra Petrochemicals Hub',
		status: 'PAUSED',
		location: 'Visakhapatnam',
		subprojectCount: 6,
		establishmentCount: 19,
		compliance: 69,
		critical: 5,
		warnings: 7,
	},
	{
		id: 'p13-s1',
		name: 'Refinery Phase I',
		status: 'PAUSED',
		location: 'Vizag Port',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 62,
		critical: 3,
		warnings: 4,
		parentId: 'p13',
	},
	{
		id: 'p13-s2',
		name: 'Chemical Storage Facility',
		status: 'PAUSED',
		location: 'Bheemunipatnam',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 71,
		critical: 2,
		warnings: 2,
		parentId: 'p13',
	},
	{
		id: 'p13-s3',
		name: 'Pipeline Network',
		status: 'ONGOING',
		location: 'Anakapalli',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 76,
		critical: 0,
		warnings: 1,
		parentId: 'p13',
	},
	{
		id: 'p13-s4',
		name: 'Worker Safety Complex',
		status: 'ONGOING',
		location: 'Atchutapuram',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 81,
		critical: 0,
		warnings: 0,
		parentId: 'p13',
	},
	{
		id: 'p13-s5',
		name: 'Environmental Control Unit',
		status: 'PLANNING',
		location: 'Nakkapalle',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 68,
		critical: 0,
		warnings: 3,
		parentId: 'p13',
	},
	{
		id: 'p13-s6',
		name: 'Port Logistics Interface',
		status: 'PAUSED',
		location: 'Gangavaram',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 58,
		critical: 0,
		warnings: 2,
		parentId: 'p13',
	},

	// 14. Punjab Agri Modernization
	{
		id: 'p14',
		name: 'Punjab Agri Modernization',
		status: 'ONGOING',
		location: 'Ludhiana',
		subprojectCount: 5,
		establishmentCount: 14,
		compliance: 93,
		critical: 0,
		warnings: 1,
	},
	{
		id: 'p14-s1',
		name: 'Irrigation Channel A',
		status: 'COMPLETED',
		location: 'Amritsar',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 96,
		critical: 0,
		warnings: 0,
		parentId: 'p14',
	},
	{
		id: 'p14-s2',
		name: 'Irrigation Channel B',
		status: 'ONGOING',
		location: 'Patiala',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 92,
		critical: 0,
		warnings: 1,
		parentId: 'p14',
	},
	{
		id: 'p14-s3',
		name: 'Cold Storage Network',
		status: 'ONGOING',
		location: 'Bathinda',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 94,
		critical: 0,
		warnings: 0,
		parentId: 'p14',
	},
	{
		id: 'p14-s4',
		name: 'Agri Processing Units',
		status: 'ONGOING',
		location: 'Jalandhar',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 91,
		critical: 0,
		warnings: 0,
		parentId: 'p14',
	},
	{
		id: 'p14-s5',
		name: 'Soil Health Lab Network',
		status: 'PLANNING',
		location: 'Ropar',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 88,
		critical: 0,
		warnings: 0,
		parentId: 'p14',
	},

	// 15. UP Expressway Extension
	{
		id: 'p15',
		name: 'UP Expressway Extension',
		status: 'ONGOING',
		location: 'Lucknow',
		subprojectCount: 4,
		establishmentCount: 11,
		compliance: 86,
		critical: 1,
		warnings: 2,
	},
	{
		id: 'p15-s1',
		name: 'Agra–Lucknow Extension',
		status: 'ONGOING',
		location: 'Agra',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 88,
		critical: 0,
		warnings: 1,
		parentId: 'p15',
	},
	{
		id: 'p15-s2',
		name: 'Lucknow Bypass Ring',
		status: 'ONGOING',
		location: 'Kanpur Road',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 82,
		critical: 1,
		warnings: 1,
		parentId: 'p15',
	},
	{
		id: 'p15-s3',
		name: 'Toll Plaza Complex',
		status: 'COMPLETED',
		location: 'Unnao',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 95,
		critical: 0,
		warnings: 0,
		parentId: 'p15',
	},
	{
		id: 'p15-s4',
		name: 'Emergency Lane & Rest Areas',
		status: 'ONGOING',
		location: 'Etawah',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 83,
		critical: 0,
		warnings: 1,
		parentId: 'p15',
	},

	// 16. Karnataka Startup City
	{
		id: 'p16',
		name: 'Karnataka Startup City',
		status: 'ONGOING',
		location: 'Bengaluru',
		subprojectCount: 5,
		establishmentCount: 17,
		compliance: 90,
		critical: 0,
		warnings: 2,
	},
	{
		id: 'p16-s1',
		name: 'Innovation Hub Tower',
		status: 'ONGOING',
		location: 'Whitefield',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 92,
		critical: 0,
		warnings: 1,
		parentId: 'p16',
	},
	{
		id: 'p16-s2',
		name: 'Research & Design Park',
		status: 'ONGOING',
		location: 'Electronic City',
		subprojectCount: null,
		establishmentCount: 4,
		compliance: 89,
		critical: 0,
		warnings: 1,
		parentId: 'p16',
	},
	{
		id: 'p16-s3',
		name: 'Incubation Blocks',
		status: 'COMPLETED',
		location: 'Hebbal',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 96,
		critical: 0,
		warnings: 0,
		parentId: 'p16',
	},
	{
		id: 'p16-s4',
		name: 'Transit Integration',
		status: 'ONGOING',
		location: 'Marathahalli',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 87,
		critical: 0,
		warnings: 0,
		parentId: 'p16',
	},
	{
		id: 'p16-s5',
		name: 'Data Center Zone',
		status: 'PLANNING',
		location: 'Devanahalli',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 84,
		critical: 0,
		warnings: 0,
		parentId: 'p16',
	},

	// 17. Himalayan Eco Resort
	{
		id: 'p17',
		name: 'Himalayan Eco Resort',
		status: 'PLANNING',
		location: 'Dehradun',
		subprojectCount: 3,
		establishmentCount: 7,
		compliance: 78,
		critical: 0,
		warnings: 3,
	},
	{
		id: 'p17-s1',
		name: 'Mountain Lodge Complex',
		status: 'PLANNING',
		location: 'Mussoorie',
		subprojectCount: null,
		establishmentCount: 3,
		compliance: 78,
		critical: 0,
		warnings: 2,
		parentId: 'p17',
	},
	{
		id: 'p17-s2',
		name: 'Trekking Infrastructure',
		status: 'PLANNING',
		location: 'Chakrata',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 75,
		critical: 0,
		warnings: 1,
		parentId: 'p17',
	},
	{
		id: 'p17-s3',
		name: 'Waste Management System',
		status: 'PLANNING',
		location: 'Dhanolti',
		subprojectCount: null,
		establishmentCount: 2,
		compliance: 82,
		critical: 0,
		warnings: 0,
		parentId: 'p17',
	},
];

// ============================================================================
// Derived stats
// ============================================================================

const PROJECT_ROWS = ALL_ROWS.filter((r) => !r.parentId);
const SUBPROJECT_ROWS = ALL_ROWS.filter((r) => !!r.parentId);
const TOTAL_ESTABLISHMENTS = PROJECT_ROWS.reduce((sum, r) => sum + (r.establishmentCount ?? 0), 0);
const AVG_COMPLIANCE = Math.round(PROJECT_ROWS.reduce((sum, r) => sum + r.compliance, 0) / PROJECT_ROWS.length);

// ============================================================================
// Helpers
// ============================================================================

function complianceColor(pct: number): string {
	if (pct >= 90) return 'text-green-400';
	if (pct >= 75) return 'text-orange-400';
	return 'text-red-400';
}

function complianceBarColor(pct: number): string {
	if (pct >= 90) return 'bg-green-500';
	if (pct >= 75) return 'bg-orange-500';
	return 'bg-red-500';
}

function statusConfig(status: ProjectRow['status']) {
	switch (status) {
		case 'ONGOING':
			return { label: 'ONGOING', classes: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
		case 'COMPLETED':
			return { label: 'COMPLETED', classes: 'bg-green-500/15 text-green-300 border-green-500/30' };
		case 'PAUSED':
			return { label: 'PAUSED', classes: 'bg-red-500/15 text-red-300 border-red-500/30' };
		case 'PLANNING':
			return { label: 'PLANNING', classes: 'bg-blue-500/15 text-blue-300 border-blue-500/30' };
	}
}

// ============================================================================
// Cell Renderers
// ============================================================================

const ProjectNameRenderer = ({ row, rowId, value, api }: CellRendererProps<ProjectRow>) => {
	const isProject = !row.parentId;
	const isExpanded = isProject ? api.isGroupExpanded(rowId) : false;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isProject) api.toggleGroupExpanded(rowId);
	};

	const cfg = statusConfig(row.status);

	return (
		<div className='flex items-center gap-1.5 h-full select-none' style={{ paddingLeft: isProject ? '0px' : '28px' }}>
			{isProject ? (
				<button
					type='button'
					onClick={handleToggle}
					className='w-5 h-5 flex items-center justify-center rounded hover:bg-slate-800 transition-colors shrink-0'
				>
					{isExpanded ? <ChevronDown className='w-3.5 h-3.5 text-blue-400' /> : <ChevronRight className='w-3.5 h-3.5 text-slate-400' />}
				</button>
			) : (
				<span className='w-4 h-4 flex items-center justify-center shrink-0 text-slate-600 text-sm font-bold select-none ml-0.5'>└</span>
			)}
			<span className={`${isProject ? 'font-bold text-slate-100' : 'text-slate-300'} text-xs truncate`}>{String(value)}</span>
			<span className={`shrink-0 text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${cfg.classes}`}>{cfg.label}</span>
		</div>
	);
};

const LocationRenderer = ({ row, value }: CellRendererProps<ProjectRow>) => {
	const isProject = !row.parentId;
	return (
		<div className='flex items-center gap-1 h-full'>
			{isProject && <MapPin className='w-3 h-3 text-slate-500 shrink-0' />}
			<span className={`text-xs ${isProject ? 'text-slate-300' : 'text-slate-400'}`}>{String(value)}</span>
		</div>
	);
};

const SubprojectCountRenderer = ({ value }: CellRendererProps<ProjectRow>) => {
	if (value === null || value === undefined) {
		return <span className='text-slate-600 text-sm font-bold select-none'>—</span>;
	}
	return <span className='font-semibold text-slate-200 text-xs'>{String(value)}</span>;
};

const EstablishmentCountRenderer = ({ value }: CellRendererProps<ProjectRow>) => {
	return <span className='font-semibold text-slate-200 text-xs'>{String(value)}</span>;
};

const ComplianceRenderer = ({ value }: CellRendererProps<ProjectRow>) => {
	const pct = Number(value) || 0;
	const barColor = complianceBarColor(pct);
	const textColor = complianceColor(pct);
	return (
		<div className='flex items-center gap-2 h-full w-full pr-2'>
			<div className='flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden min-w-0'>
				<div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
			</div>
			<span className={`text-xs font-bold shrink-0 ${textColor}`}>{pct}%</span>
		</div>
	);
};

const CriticalRenderer = ({ value }: CellRendererProps<ProjectRow>) => {
	const n = Number(value) || 0;
	return (
		<span className={`text-xs font-bold ${n > 0 ? 'text-red-400' : 'text-slate-600'}`}>
			{n > 0 ? n : <span className='text-slate-600'>0</span>}
		</span>
	);
};

const WarningsRenderer = ({ value }: CellRendererProps<ProjectRow>) => {
	const n = Number(value) || 0;
	return (
		<span className={`text-xs font-bold ${n > 0 ? 'text-orange-400' : 'text-slate-600'}`}>
			{n > 0 ? n : <span className='text-slate-600'>0</span>}
		</span>
	);
};

interface ActionsRendererProps extends CellRendererProps<ProjectRow> {
	onAddSubproject: (projectId: string) => void;
}

const makeActionsRenderer = (onAddSubproject: (projectId: string) => void) => {
	return function ActionsRenderer({ row, rowId }: CellRendererProps<ProjectRow>) {
		const isProject = !row.parentId;
		if (isProject) {
			return (
				<div className='flex items-center gap-1 h-full'>
					<button
						type='button'
						onClick={(e) => {
							e.stopPropagation();
						}}
						className='flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-slate-300 border border-slate-800 hover:border-slate-700 hover:text-white bg-slate-950/60 hover:bg-slate-900/80 transition-all'
					>
						<FileText className='w-3 h-3' />
						Report
					</button>
					<button
						type='button'
						onClick={(e) => {
							e.stopPropagation();
							onAddSubproject(rowId);
						}}
						className='flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-blue-400 border border-blue-900/50 hover:border-blue-700/60 hover:text-blue-300 bg-blue-950/20 hover:bg-blue-950/40 transition-all'
					>
						<Plus className='w-3 h-3' />
						Sub
					</button>
				</div>
			);
		}
		return (
			<button
				type='button'
				onClick={(e) => e.stopPropagation()}
				className='flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold text-slate-400 border border-slate-800 hover:border-slate-700 hover:text-white bg-slate-950/60 hover:bg-slate-900/80 transition-all'
			>
				View
				<ExternalLink className='w-3 h-3' />
			</button>
		);
	};
};

// ============================================================================
// Style rules config (defined at module level so it's stable)
// ============================================================================

const STYLE_RULES: StyleRule<ProjectRow>[] = [
	{
		kind: 'row' as const,
		when: (row: ProjectRow) => !row.parentId,
		rowClass: 'border-l-[3px] border-blue-500 bg-blue-950/5',
	},
	{
		kind: 'row' as const,
		when: (row: ProjectRow) => !!row.parentId && row.compliance >= 90,
		rowClass: 'border-l-[3px] border-green-500',
	},
	{
		kind: 'row' as const,
		when: (row: ProjectRow) => !!row.parentId && row.compliance >= 75 && row.compliance < 90,
		rowClass: 'border-l-[3px] border-orange-500',
	},
	{
		kind: 'row' as const,
		when: (row: ProjectRow) => !!row.parentId && row.compliance < 75,
		rowClass: 'border-l-[3px] border-red-500',
	},
];

// ============================================================================
// Page component
// ============================================================================

interface ProjectsComplianceDemoProps {
	onGridReady?: (event: GridReadyEvent<any>) => void;
}

export default function ProjectsComplianceDemo({ onGridReady }: ProjectsComplianceDemoProps) {
	const [searchText, setSearchText] = useState('');
	const [statusFilter, setStatusFilter] = useState<'All' | 'ONGOING' | 'COMPLETED' | 'PAUSED' | 'PLANNING'>('All');
	const [lastAction, setLastAction] = useState<string | null>(null);
	const [api, setApi] = useState<GridApi<ProjectRow> | null>(null);

	const handleAddSubproject = useCallback((projectId: string) => {
		const project = ALL_ROWS.find((r) => r.id === projectId);
		setLastAction(`Add subproject to "${project?.name ?? projectId}"`);
	}, []);

	const ActionsRenderer = useMemo(() => makeActionsRenderer(handleAddSubproject), [handleAddSubproject]);

	const filteredRows = useMemo(() => {
		const lower = searchText.toLowerCase().trim();
		let rows = ALL_ROWS;
		if (statusFilter !== 'All') {
			const parentIds = new Set(ALL_ROWS.filter((r) => !r.parentId && r.status === statusFilter).map((r) => r.id));
			rows = rows.filter((r) => {
				if (!r.parentId) return r.status === statusFilter;
				return parentIds.has(r.parentId);
			});
		}
		if (lower) {
			const matchIds = new Set<string>();
			for (const row of rows) {
				if (row.name.toLowerCase().includes(lower) || row.location.toLowerCase().includes(lower)) {
					matchIds.add(row.id);
					if (row.parentId) matchIds.add(row.parentId);
				}
			}
			rows = rows.filter((r) => matchIds.has(r.id));
		}
		return rows;
	}, [searchText, statusFilter]);

	const visibleProjectCount = useMemo(() => filteredRows.filter((r) => !r.parentId).length, [filteredRows]);

	const columns = useMemo<ColumnDef<ProjectRow>[]>(
		() => [
			{
				field: 'name',
				header: 'PROJECT / SUBPROJECT',
				width: 340,
				renderer: {
					kind: 'react',
					component: ProjectNameRenderer,
					capabilities: { scrollPresentation: 'live', live: { priority: 'high', allowEmergencyShell: true } },
				},
			},
			{
				field: 'location',
				header: 'LOCATION',
				width: 160,
				renderer: {
					kind: 'react',
					component: LocationRenderer,
					capabilities: { scrollPresentation: 'live', live: { priority: 'high', allowEmergencyShell: true } },
				},
			},
			{
				field: 'subprojectCount',
				header: 'SUB.',
				width: 70,
				renderer: { kind: 'react', component: SubprojectCountRenderer },
			},
			{
				field: 'establishmentCount',
				header: 'ESTAB.',
				width: 80,
				renderer: { kind: 'react', component: EstablishmentCountRenderer },
			},
			{
				field: 'compliance',
				header: 'COMPLIANCE',
				width: 180,
				renderer: {
					kind: 'react',
					component: ComplianceRenderer,
					capabilities: { scrollPresentation: 'live', live: { priority: 'high', allowEmergencyShell: true } },
				},
			},
			{
				field: 'critical',
				header: 'CRIT.',
				width: 70,
				renderer: { kind: 'react', component: CriticalRenderer },
			},
			{
				field: 'warnings',
				header: 'WARN.',
				width: 70,
				renderer: { kind: 'react', component: WarningsRenderer },
			},
			{
				field: 'actions',
				header: 'ACTIONS',
				width: 140,
				valueGetter: () => null,
				renderer: {
					kind: 'react',
					component: ActionsRenderer,
					capabilities: { scrollPresentation: 'live', live: { priority: 'high', allowEmergencyShell: true } },
				},
			},
		],
		[ActionsRenderer]
	);

	const treeInitialState = useMemo(
		() =>
			({
				rowModelConfig: {
					type: 'client',
					treeData: {
						enabled: true,
						getParentId: (row: ProjectRow) => row.parentId,
					},
				},
				expansion: {
					groups: {},
					treeRows: { p1: true } as Record<string, true>,
					details: {},
				},
			}) as GridInitialState<ProjectRow>,
		[]
	);

	const handleGridReady = useCallback(
		(event: GridReadyEvent<ProjectRow>) => {
			setApi(event.api);
			onGridReady?.(event);
		},
		[onGridReady]
	);

	const handleExpandAll = () => {
		if (!api) return;
		PROJECT_ROWS.forEach((r) => {
			if (!api.isGroupExpanded(r.id)) api.toggleGroupExpanded(r.id);
		});
	};

	const handleCollapseAll = () => {
		if (!api) return;
		PROJECT_ROWS.forEach((r) => {
			if (api.isGroupExpanded(r.id)) api.toggleGroupExpanded(r.id);
		});
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden font-sans'>
			{/* Left: main grid panel */}
			<div className='flex-1 flex flex-col gap-3 min-h-0 min-w-0 overflow-hidden'>
				{/* Stats header */}
				<div className='flex items-center gap-3 shrink-0 flex-wrap'>
					<div className='flex items-center gap-2.5 flex-1 min-w-0 flex-wrap gap-y-2'>
						{[
							{ label: 'Projects', value: PROJECT_ROWS.length },
							{ label: 'Subprojects', value: SUBPROJECT_ROWS.length },
							{ label: 'Establishments', value: TOTAL_ESTABLISHMENTS },
						].map(({ label, value }) => (
							<div
								key={label}
								className='flex items-baseline gap-1.5 px-4 py-2.5 rounded-xl border border-slate-800/80 bg-slate-900/30 shadow-sm'
							>
								<span className='text-sm font-extrabold text-slate-100'>{value}</span>
								<span className='text-[10px] font-semibold text-slate-500'>{label}</span>
							</div>
						))}
						<div className='flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-800/80 bg-slate-900/30 shadow-sm'>
							<span className='w-2 h-2 rounded-full bg-green-400 shadow-lg shadow-green-400/40' />
							<span className='text-sm font-extrabold text-slate-100'>{AVG_COMPLIANCE}%</span>
							<span className='text-[10px] font-semibold text-slate-500'>Compliant</span>
						</div>
					</div>
					<button
						type='button'
						className='flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors shadow-lg shadow-blue-600/20 shrink-0'
					>
						<Plus className='w-3.5 h-3.5' />
						Add Project
					</button>
				</div>

				{/* Search & filter toolbar */}
				<div className='flex items-center gap-2.5 shrink-0 flex-wrap gap-y-2'>
					<div className='flex-1 min-w-[200px] relative'>
						<Search className='absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none' />
						<input
							type='text'
							value={searchText}
							onChange={(e) => setSearchText(e.target.value)}
							placeholder='Search projects or subprojects...'
							className='w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800/80 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-600/60 focus:bg-slate-900/70 transition-all'
						/>
					</div>
					<div className='flex items-center gap-1.5'>
						<Filter className='w-3.5 h-3.5 text-slate-500' />
						<span className='text-[10px] text-slate-500 font-semibold'>Status:</span>
						<select
							value={statusFilter}
							onChange={(e) => setStatusFilter(e.target.value as any)}
							className='px-2 py-2 rounded-lg bg-slate-900/40 border border-slate-800/80 text-xs text-slate-300 focus:outline-none focus:border-blue-600/60 cursor-pointer transition-all'
						>
							{['All', 'ONGOING', 'COMPLETED', 'PAUSED', 'PLANNING'].map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					</div>
					<div className='flex items-center gap-1.5'>
						<ArrowUpDown className='w-3.5 h-3.5 text-slate-500' />
						<span className='text-[10px] text-slate-500 font-semibold'>Sort:</span>
						<select className='px-2 py-2 rounded-lg bg-slate-900/40 border border-slate-800/80 text-xs text-slate-300 focus:outline-none focus:border-blue-600/60 cursor-pointer transition-all'>
							<option>Name A–Z</option>
							<option>Compliance ↑</option>
							<option>Compliance ↓</option>
							<option>Critical ↓</option>
						</select>
					</div>
					<div className='flex items-center gap-1'>
						<button
							type='button'
							onClick={handleExpandAll}
							className='px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-400 border border-slate-800 hover:text-white hover:border-slate-700 transition-all'
						>
							Expand All
						</button>
						<button
							type='button'
							onClick={handleCollapseAll}
							className='px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-400 border border-slate-800 hover:text-white hover:border-slate-700 transition-all'
						>
							Collapse All
						</button>
					</div>
				</div>

				{/* Grid */}
				<div className='flex-1 min-h-0 border border-slate-900 rounded-xl overflow-hidden bg-slate-950 shadow-2xl relative'>
					<Grid
						rowModelType='client'
						rows={filteredRows}
						columns={columns}
						initialState={treeInitialState}
						styleRules={STYLE_RULES}
						enableNavigation={false}
						onGridReady={handleGridReady}
					/>
				</div>

				{/* Footer */}
				<div className='flex items-center justify-center gap-1.5 text-[10px] text-slate-500 shrink-0 pb-0.5'>
					<span>↓</span>
					<span>
						{visibleProjectCount} project{visibleProjectCount !== 1 ? 's' : ''} shown
					</span>
					<span>·</span>
					<span>Click a project row to expand / collapse its subprojects</span>
				</div>
			</div>

			{/* Right sidebar: feature explainer */}
			<div className='w-full xl:w-72 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5 leading-normal'>
				{/* Feature overview */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-10 -translate-y-10 w-20 h-20 bg-blue-600/6 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Building2 className='w-4 h-4 text-blue-400' />
						Tree Data + Custom Renderers
					</h3>
					<p className='text-xs text-slate-300 leading-relaxed'>
						Projects and their subprojects are loaded as a flat array. The grid builds the tree hierarchy via{' '}
						<span className='font-mono text-blue-400 text-[10px]'>getParentId</span> — no nested structures needed.
					</p>
					<div className='flex flex-col gap-2 text-[10px] border-t border-slate-800/60 pt-3'>
						{[
							{ icon: CheckCircle2, color: 'text-green-400', text: 'Flat data → tree rendering' },
							{ icon: CheckCircle2, color: 'text-green-400', text: 'Per-row expand / collapse' },
							{ icon: CheckCircle2, color: 'text-green-400', text: 'Compliance bar + color coding' },
							{ icon: CheckCircle2, color: 'text-green-400', text: 'Left-border style rules' },
							{ icon: CheckCircle2, color: 'text-green-400', text: 'Dynamic search + status filter' },
						].map(({ icon: Icon, color, text }) => (
							<div key={text} className='flex items-center gap-2 text-slate-400'>
								<Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
								<span>{text}</span>
							</div>
						))}
					</div>
				</div>

				{/* Style rules legend */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Layers className='w-4 h-4 text-purple-400' />
						Row Style Rules
					</h3>
					<div className='flex flex-col gap-2 text-[10px]'>
						<div className='flex items-center gap-2.5'>
							<div className='w-1 h-7 rounded bg-blue-500 shrink-0' />
							<div>
								<div className='font-bold text-slate-300'>Project row</div>
								<div className='text-slate-500'>Always blue · top-level</div>
							</div>
						</div>
						<div className='flex items-center gap-2.5'>
							<div className='w-1 h-7 rounded bg-green-500 shrink-0' />
							<div>
								<div className='font-bold text-slate-300'>≥ 90% compliance</div>
								<div className='text-slate-500'>Green · on-track</div>
							</div>
						</div>
						<div className='flex items-center gap-2.5'>
							<div className='w-1 h-7 rounded bg-orange-500 shrink-0' />
							<div>
								<div className='font-bold text-slate-300'>75–89% compliance</div>
								<div className='text-slate-500'>Orange · needs attention</div>
							</div>
						</div>
						<div className='flex items-center gap-2.5'>
							<div className='w-1 h-7 rounded bg-red-500 shrink-0' />
							<div>
								<div className='font-bold text-slate-300'>&lt; 75% compliance</div>
								<div className='text-slate-500'>Red · critical</div>
							</div>
						</div>
					</div>
				</div>

				{/* Portfolio health */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<TrendingUp className='w-4 h-4 text-emerald-400' />
						Portfolio Health
					</h3>
					{(['ONGOING', 'COMPLETED', 'PAUSED', 'PLANNING'] as const).map((s) => {
						const count = PROJECT_ROWS.filter((r) => r.status === s).length;
						const pct = Math.round((count / PROJECT_ROWS.length) * 100);
						const cfg = statusConfig(s);
						return (
							<div key={s} className='flex items-center gap-2'>
								<span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${cfg.classes} w-16 text-center`}>
									{cfg.label}
								</span>
								<div className='flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden'>
									<div
										className={`h-full rounded-full ${s === 'ONGOING' ? 'bg-amber-500' : s === 'COMPLETED' ? 'bg-green-500' : s === 'PAUSED' ? 'bg-red-500' : 'bg-blue-500'}`}
										style={{ width: `${pct}%` }}
									/>
								</div>
								<span className='text-[10px] font-mono text-slate-400 w-6 text-right'>{count}</span>
							</div>
						);
					})}
				</div>

				{/* Compliance watchlist */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<ShieldCheck className='w-4 h-4 text-rose-400' />
						Critical Watchlist
					</h3>
					<div className='flex flex-col gap-2'>
						{PROJECT_ROWS.filter((r) => r.critical > 0 || r.compliance < 80)
							.sort((a, b) => a.compliance - b.compliance)
							.slice(0, 5)
							.map((r) => (
								<div key={r.id} className='flex items-center justify-between text-[10px]'>
									<div className='flex flex-col min-w-0'>
										<span className='font-semibold text-slate-300 truncate'>{r.name}</span>
										<span className='text-slate-500'>{r.location}</span>
									</div>
									<div className='flex items-center gap-1.5 shrink-0 ml-2'>
										{r.critical > 0 && (
											<span className='text-red-400 font-bold flex items-center gap-0.5'>
												<AlertCircle className='w-3 h-3' />
												{r.critical}
											</span>
										)}
										<span className={`font-bold ${complianceColor(r.compliance)}`}>{r.compliance}%</span>
									</div>
								</div>
							))}
					</div>
				</div>

				{/* Action log */}
				{lastAction && (
					<div className='p-3.5 rounded-xl border border-blue-900/50 bg-blue-950/20 flex flex-col gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-300'>
						<h3 className='text-[10px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Info className='w-3.5 h-3.5' />
							Action
						</h3>
						<p className='text-xs text-slate-300'>{lastAction}</p>
						<button
							type='button'
							onClick={() => setLastAction(null)}
							className='text-[9px] text-slate-500 hover:text-slate-300 transition-colors self-end mt-0.5'
						>
							Dismiss
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
