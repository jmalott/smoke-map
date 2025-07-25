/**
 * Variables
 */

// Debug?
const DEBUG = false;

// API root
const PROXY_API_ROOT = 'https://visitcentraloregon.com/wp-json/api/environment';
// const PROXY_API_ROOT = 'http://localhost:8080/wp-json/api/environment'; // not needed in production

// How often do we reload if the window is open?
const AUTO_RELOAD_DELAY = 15 * 60 * 1000; // 15 minutes

// Geographic constants for map display and APIs to use
const GEO_CONSTANTS = {
    CENTER_LAT: 44.0582,
    CENTER_LNG: -121.3153,
    INITIAL_ZOOM: 6,
    MAX_ZOOM: 12,
    MAX_ZOOM_SATELLITE: 17,
    MIN_ZOOM_REGIONAL: 7,
    REGION_BOUNDS: {
        SOUTHWEST_LAT: 38.0,
        SOUTHWEST_LNG: -125.5,
        NORTHEAST_LAT: 49.0,
        NORTHEAST_LNG: -114.0
    },
    CENTRAL_OREGON_BOUNDS: {
        SOUTHWEST_LAT: 42.0,
        SOUTHWEST_LNG: -122.3,
        NORTHEAST_LAT: 45.5,
        NORTHEAST_LNG: -119.2
    },
    // Traffic cameras to the south are not needed 
    OREGON_CAMERA_BOUNDS: {
        SOUTHWEST_LAT: 43.3,
        SOUTHWEST_LNG: -122.3,
        NORTHEAST_LAT: 45.5,
        NORTHEAST_LNG: -119.2
    }
};

// Predefined regional locations for air quality data fetching.
const REGIONAL_LOCATIONS = [
    { name: 'Bend, OR', lat: 44.058174, lon: -121.315308 },
    { name: 'Culver, OR', lat: 44.531360, lon: -121.335136 },
    { name: 'La Pine, OR', lat: 43.679167, lon: -121.495833 },
    { name: 'Madras, OR', lat: 44.64, lon: -121.12 },
    { name: 'Maupin, OR', lat: 45.173056, lon: -121.088056 },
    { name: 'Prineville, OR', lat: 44.299946, lon: -120.833298 },
    { name: 'Redmond, OR', lat: 44.270833, lon: -121.166667 },
    { name: 'Sisters, OR', lat: 44.2909491, lon: -121.5492118 },
    { name: 'Sunriver, OR', lat: 43.873333, lon: -121.438333 },
    { name: 'Terrebonne, OR', lat: 44.35, lon: -121.183333 },
    { name: 'Tumalo, OR', lat: 44.149841, lon: -121.330872 },
    { name: 'Warm Springs', lat: 44.760168, lon: -121.268233 }
];

// What data are we loading for Oregon traffic (see https://api.odot.state.or.us/tripcheck/Incidents/Metadata)
const CONFIG_OREGON_TRAFFIC = {
    EVENT_TYPES: 'DS,LE,WT',
    EVENT_SUBTYPES: '65,80,85,95,110,115,120'
};

// Time parameters for smoke
const CONFIG_SMOKE = {
    START_HOURS_OFFSET: -12,
    DURATION_HOURS: 48,
    HOUR_INTERVAL: 1
};

// Fire parameters
const CONGIG_FIRE = {
    DISCOVERY_AGE: 14,
    ACRE_AGE_OVERRIDE: 10000,
    EXCLUDE_FULLY_CONTAINED: true
};

// What to display for air quality
const CONFIG_AIR_QUALITY = {
    DISPLAY_MODE: 'aqi_pm25',
    UPDATE_WITH_TIME: true
};

// Camera Cluster Grouping Configuration
const CAMERA_CLUSTER_CONFIG = {
    ENABLED: true,
    MAX_CLUSTER_RADIUS: 80,
    DISABLE_CLUSTERING_AT_ZOOM: 11,
    SHOW_COVERAGE_ON_HOVER: false
};

// Z-index for markers
const Z_INDEX_SMOKE = 300;
const Z_INDEX_CAMERA = 400;
const Z_INDEX_FIRE_PERIMETER = 500;
const Z_INDEX_FIRE = 600;
const Z_INDEX_AIR_QUALITY = 700;
const Z_INDEX_INCIDENT = 800;

// Custom markers for the map to show regional points of interest
const CUSTOM_MARKERS = [
    {
        ICON: '✈️',
        TEXT: 'Redmond Airport',
        LAT: 44.253201718700616,
        LNG: -121.16080291621827
    }
];    

// Flag to determine if the map should cover a nationwide area (false in production).
const NATIONWIDE = false;

// Map and layer variables
let map;
let defaultTiles;
let satelliteTiles;
let smokeLayers = [];
let cameraLayer;
let incidentLayer;
let fireLayer;
let firePerimeterLayer;
let airQualityLayer;

// Air quality data storage
let airQualityData = {};
let airQualityMarkers = [];

// Smoke animation variables
let timeExtents = [];
let currentTimeIndex = 0;
let isAnimating = false;
let animationInterval = null;
let animationSpeed = 1000;
let totalHours = CONFIG_SMOKE.DURATION_HOURS;

// Loading state variables
let loadingErrors = [];
let loadedCount = 0;
let errorCount = 0;
let shouldContinueLoading = true;
let activeRequests = 0;
let isProgressiveLoading = false;
let progressiveLoadingIndex = 0;
let availableLayerCount = 0;
let allDataLoaded = false;

// Layer visibility state
let showSmoke = true;
let showCameras = true;
let showIncidents = true;
let showFires = true;
let showFirePerimeters = true;
let showAirQuality = true;
let isLoadingTraffic = false;
let isLoadingFires = false;
let isLoadingAirQuality = false;
let isLoadingPerimeters = false; 

// Tracking globally to toggle off if they are not present (will change to zero later)
let incidentCountGlobal = -1;

// Fire markers storage
let fireMarkers = [];

// Store fire incident data for cross-referencing with perimeters
let fireIncidentsData = new Map();

/**
 * Initializes the Leaflet map, sets its view, adds base tile layers,
 * and initializes overlay layers for cameras, incidents, fires, and air quality.
 */
function initMap() {
    map = L.map('map', {
        minZoom: NATIONWIDE ? 3 : GEO_CONSTANTS.MIN_ZOOM_REGIONAL
    }).setView([GEO_CONSTANTS.CENTER_LAT, GEO_CONSTANTS.CENTER_LNG], GEO_CONSTANTS.INITIAL_ZOOM);
    
    const darkMode = window.smokeMapSettings && window.smokeMapSettings.darkMode;
    const defaultTileUrl = darkMode ?
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png' :
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

    defaultTiles = L.tileLayer(defaultTileUrl, {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: GEO_CONSTANTS.MAX_ZOOM
    });

    satelliteTiles = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: GEO_CONSTANTS.MAX_ZOOM
    });

    // The preferred layer for default
    defaultTiles.addTo(map);

    // Panes to control stacking order
    map.createPane('smokePane');
    map.getPane('smokePane').style.zIndex = Z_INDEX_SMOKE;

    map.createPane('perimeterPane');
    map.getPane('perimeterPane').style.zIndex = Z_INDEX_FIRE_PERIMETER;
    
    map.createPane('cameraPane');
    map.getPane('cameraPane').style.zIndex = Z_INDEX_CAMERA;

    map.createPane('incidentPane');
    map.getPane('incidentPane').style.zIndex = Z_INDEX_INCIDENT;

    map.createPane('airQualityPane');
    map.getPane('airQualityPane').style.zIndex = Z_INDEX_AIR_QUALITY;

    if (!NATIONWIDE) {
        const mapBounds = L.latLngBounds(
            [GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LAT, GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LNG], 
            [GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LAT, GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LNG]
        );
        map.setMaxBounds(mapBounds);
        
        map.on('drag', function() {
            map.panInsideBounds(mapBounds, { animate: false });
        });
        
        map.on('zoomend', function() {
            if (map.getZoom() < GEO_CONSTANTS.MIN_ZOOM_REGIONAL) {
                map.setZoom(GEO_CONSTANTS.MIN_ZOOM_REGIONAL);
            }
        });
    }
    
    // Initialize layers (these go on top of smoke)
    if (CAMERA_CLUSTER_CONFIG.ENABLED) {
        cameraLayer = L.markerClusterGroup({
            maxClusterRadius: CAMERA_CLUSTER_CONFIG.MAX_CLUSTER_RADIUS,
            disableClusteringAtZoom: CAMERA_CLUSTER_CONFIG.DISABLE_CLUSTERING_AT_ZOOM,
            showCoverageOnHover: CAMERA_CLUSTER_CONFIG.SHOW_COVERAGE_ON_HOVER,
            iconCreateFunction: function(cluster) {
                const childCount = cluster.getChildCount();
                
                return L.divIcon({
                    // KEYWORD custom_camera_icon
                    html: `
                        <div class="marker-cluster-camera">
                            <div class="camera-base">📸</div>
                            <div class="cluster-count">${childCount}</div>
                        </div>
                    `,
                    className: 'marker-cluster-camera-icon',
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });
            }
        }).addTo(map);
    } else {
        cameraLayer = L.layerGroup().addTo(map);
    }
    incidentLayer = L.layerGroup().addTo(map);
    fireLayer = L.layerGroup().addTo(map);
    firePerimeterLayer = L.layerGroup().addTo(map);
    airQualityLayer = L.layerGroup().addTo(map);

    // Custom icons
    CUSTOM_MARKERS.forEach(marker => {
        const customIcon = L.divIcon({
            html: marker.ICON,
            className: 'marker-custom',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
        });
        
        // Add marker to the map
        L.marker([marker.LAT, marker.LNG], { icon: customIcon
        })
        .bindPopup(marker.TEXT || '')
        .addTo(map);
    });
    
    // Add zoom event listener to update fire icon sizes
    map.on('zoom', updateFireIconSizes);
    map.on('zoomend', updateFireIconSizes);
    
    initializeTimeControls();
    initializeLayerToggles();
    initializeTileToggles();
}

/**
 * Initializes event listeners for the layer toggle buttons.
 * Controls the visibility of smoke, fire, camera, incident, fire perimeters, and air quality layers.
 */
function initializeLayerToggles() {
    const toggleSmokeBtn = document.getElementById('toggleSmoke');
    const toggleCamerasBtn = document.getElementById('toggleCameras');
    const toggleIncidentsBtn = document.getElementById('toggleIncidents');
    const toggleFiresBtn = document.getElementById('toggleFires');
    const toggleAirQualityBtn = document.getElementById('toggleAirQuality');
    
    // Smoke toggle
    toggleSmokeBtn.addEventListener('click', () => {
        showSmoke = !showSmoke;
        updateToggleText(toggleSmokeBtn, showSmoke);
        
        // If hiding smoke and animation is playing, pause it
        if (!showSmoke && isAnimating) {
            stopAnimation();
        }
        
        // Show/hide current smoke layer
        if (smokeLayers[currentTimeIndex] && smokeLayers[currentTimeIndex].layer) {
            if (showSmoke) {
                smokeLayers[currentTimeIndex].layer.addTo(map);
            } else {
                map.removeLayer(smokeLayers[currentTimeIndex].layer);
            }
        }
    });
    
    // Fire and perimeter toggle
    toggleFiresBtn.addEventListener('click', () => {
        showFires = !showFires;
        toggleLayer(fireLayer, showFires);
        showFirePerimeters = !showFirePerimeters;
        toggleLayer(firePerimeterLayer, showFirePerimeters);
        updateToggleText(toggleFiresBtn, showFirePerimeters);
    });
    
    // Camera toggle
    toggleCamerasBtn.addEventListener('click', () => {
        showCameras = !showCameras;
        toggleLayer(cameraLayer, showCameras);
        updateToggleText(toggleCamerasBtn, showCameras);
    });
    
    // Incident toggle
    toggleIncidentsBtn.addEventListener('click', () => {
        if (toggleIncidentsBtn.classList.contains('disabled')) {
            return;
        }

        showIncidents = !showIncidents;
        toggleLayer(incidentLayer, showIncidents);
        updateToggleText(toggleIncidentsBtn, showIncidents);
    });
    
    // Air Quality toggle
    toggleAirQualityBtn.addEventListener('click', () => {
        showAirQuality = !showAirQuality;
        toggleLayer(airQualityLayer, showAirQuality);
        updateToggleText(toggleAirQualityBtn, showAirQuality);
    });
}

/**
 * Initializes event listeners for the core map tile toggle buttons.
 */
function initializeTileToggles() {
    const defaultTilesBtn = document.getElementById('defaultTilesBtn');
    const satelliteTilesBtn = document.getElementById('satelliteTilesBtn');

    // Event listener for default tiles button
    defaultTilesBtn.addEventListener('click', () => {
        if (!map.hasLayer(defaultTiles)) { // Only switch if not already active
            map.removeLayer(satelliteTiles);
            defaultTiles.addTo(map);
            updateTileChooser(defaultTilesBtn, satelliteTilesBtn);
        }
    });

    // Event listener for satellite tiles button
    satelliteTilesBtn.addEventListener('click', () => {
        if (!map.hasLayer(satelliteTiles)) { // Only switch if not already active
            map.removeLayer(defaultTiles);
            satelliteTiles.addTo(map);
            updateTileChooser(satelliteTilesBtn, defaultTilesBtn);
        }
    });
}

/**
 * Toggles the visibility of a given Leaflet layer group on the map.
 * 
 * @param {L.LayerGroup} layerGroup - The Leaflet layer group to toggle.
 * @param {boolean} show - True to show the layer, false to hide it.
 */
function toggleLayer(layerGroup, show) {
    if (show) {
        map.addLayer(layerGroup);
    } else {
        map.removeLayer(layerGroup);
    }
}

/**
 * Changes the hide/show text for a toggle button
 * 
 * @param {div} activeButton - The button to make active.
 * @param {div} inactiveButton - The button to make inactive.
 */
function updateTileChooser(activeButton, inactiveButton) {
    activeButton.classList.remove('active');
    inactiveButton.classList.remove('active');
    activeButton.classList.add('active');
}

/**
 * Changes the hide/show text for a toggle button
 * 
 * @param {boolean} show - Are we showing? If false, hide.
 * @param {div} buttonEl - The button element to act on.
 */ 
    function updateToggleText(buttonEl, show) {
    buttonEl.innerHTML = (show) 
        ? buttonEl.innerHTML.replace('Show', 'Hide') 
        : buttonEl.innerHTML.replace('Hide', 'Show');
    buttonEl.classList.toggle('inactive', !show);
    }

/**
 * Returns the CSS class name corresponding to an AQI value for coloring markers.
 * 
 * @param {number} aqi - The Air Quality Index value.
 * @returns {string} The CSS class name (e.g., 'good', 'moderate', 'unhealthy').
 */
function getAQIColor(aqi) {
    if (aqi <= 50) return 'good';
    if (aqi <= 100) return 'moderate';
    if (aqi <= 150) return 'unhealthy-sensitive';
    if (aqi <= 200) return 'unhealthy';
    if (aqi <= 300) return 'very-unhealthy';
    return 'hazardous';
}

/**
 * Returns a descriptive string for an AQI value.
 * 
 * @param {number} aqi - The Air Quality Index value.
 * @returns {string} The description (e.g., 'Good', 'Moderate').
 */
function getAQIDescription(aqi) {
    if (aqi <= 50) return 'Good';
    if (aqi <= 100) return 'Moderate';
    if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
    if (aqi <= 200) return 'Unhealthy';
    if (aqi <= 300) return 'Very Unhealthy';
    return 'Hazardous';
}

/**
 * Formats a Date object into a 'YYYY-MM-DD' string for API requests.
 * 
 * @param {Date} date - The date object to format.
 * @returns {string} The formatted date string.
 */
function formatDateForAPI(date) {
    return date.toISOString().split('T')[0];
}

/**
 * Formats a Date object into a 'HH:MM' string for API requests.
 * 
 * @param {Date} date - The date object to format.
 * @returns {string} The formatted time string.
 */
function formatTimeForAPI(date) {
    return date.toISOString().split('T')[1].substring(0, 5);
}

/**
 * Asynchronously loads air quality data for predefined regional locations.
 * Fetches hourly AQI, PM2.5, and PM10 data from a proxy.
 * Updates `airQualityData` and then `airQualityMarkers`.
 * 
 * @async
 * @returns {Promise<number>} A promise that resolves with the count of successfully loaded locations.
 * @throws {Error} If there's an error during data fetching or processing.
 */
async function loadAirQualityData() {
    if (isLoadingAirQuality || timeExtents.length === 0) return;
    
    isLoadingAirQuality = true;
    airQualityData = {};
    
    try {
        const startTime = new Date(timeExtents[0].start);
        const endTime = new Date(timeExtents[timeExtents.length - 1].end);
        
        const startDate = formatDateForAPI(startTime);
        const endDate = formatDateForAPI(endTime);
        const startTimeStr = formatTimeForAPI(startTime);
        const endTimeStr = formatTimeForAPI(endTime);
        
        const promises = REGIONAL_LOCATIONS.map(async (location) => {
            try {
                const response = await fetch(`${PROXY_API_ROOT}/air-quality?lat=${location.lat}&lon=${location.lon}&hourly=us_aqi_pm2_5,us_aqi_pm10,us_aqi&current=us_aqi&timezone=America/Los_Angeles&domains=cams_global&start_date=${startDate}&end_date=${endDate}&start_time=${startTimeStr}&end_time=${endTimeStr}`);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const resultData = await response.json();
                
                if (resultData.hourly && resultData.hourly.time) {
                    airQualityData[location.name] = {
                        location: location,
                        hourly: resultData.hourly,
                        current: resultData.current
                    };
                }
                
                return { location: location.name, success: true };
            } catch (error) {
                if (DEBUG) console.error(`Error loading air quality for ${location.name}:`, error);
                return { location: location.name, success: false, error };
            }
        });
        
        const results = await Promise.all(promises);
        const successCount = results.filter(r => r.success).length;
        
        if (DEBUG) console.log(`Loaded air quality data for ${successCount}/${REGIONAL_LOCATIONS.length} locations`);
        
        // Update air quality markers for current time
        updateAirQualityMarkers();
        
        return successCount;
        
    } catch (error) {
        if (DEBUG) console.error('Error loading air quality data:', error);
        throw error;
    } finally {
        isLoadingAirQuality = false;
    }
}

/**
 * Clears existing air quality markers and recreates them based on the current
 * `airQualityData` and `currentTimeIndex`.
 * Markers display AQI values and are styled according to air quality levels.
 */
function updateAirQualityMarkers() {
    // Clear existing markers
    airQualityLayer.clearLayers();
    airQualityMarkers = [];
    
    if (timeExtents.length === 0) return;
    
    const currentTime = timeExtents[currentTimeIndex];
    if (!currentTime) return;
    
    Object.keys(airQualityData).forEach(locationName => {
        const locationData = airQualityData[locationName];
        const location = locationData.location;
        
        // Find the closest time index in the air quality data
        const targetTime = new Date(currentTime.start);
        const hourlyTimes = locationData.hourly.time.map(t => new Date(t));
        
        let closestIndex = 0;
        let minDiff = Math.abs(hourlyTimes[0] - targetTime);
        
        for (let i = 1; i < hourlyTimes.length; i++) {
            const diff = Math.abs(hourlyTimes[i] - targetTime);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }
        
        // Get AQI values for this time
        const aqi = locationData.hourly.us_aqi[closestIndex];
        const pm25_aqi = locationData.hourly.us_aqi_pm2_5[closestIndex];
        const pm10_aqi = locationData.hourly.us_aqi_pm10[closestIndex];
        
        if (aqi !== null && aqi !== undefined) {
            createAirQualityMarker(location, aqi, pm25_aqi, pm10_aqi, locationData, hourlyTimes[closestIndex]);
        }
    });
}

/**
 * Creates and adds a single air quality marker to the map.
 * The marker's appearance (color, displayed text) depends on the AQI value and `CONFIG_AIR_QUALITY.DISPLAY_MODE`.
 * A popup with detailed AQI information is bound to the marker.
 * 
 * @param {object} location - The geographic location data (lat, lon, name).
 * @param {number} aqi - The overall US AQI value.
 * @param {number|null} pm25_aqi - The PM2.5 AQI value, or null if unavailable.
 * @param {number|null} pm10_aqi - The PM10 AQI value, or null if unavailable.
 * @param {object} locationData - The full air quality data object for the location.
 * @param {Date} measurementTime - The specific time of this AQI measurement.
 */
function createAirQualityMarker(location, aqi, pm25_aqi, pm10_aqi, locationData, measurementTime) {
    // Determine which value to use for coloring based on display mode
    let colorValue = aqi; // default
    switch (CONFIG_AIR_QUALITY.DISPLAY_MODE) {
        case 'pm25_only':
            colorValue = pm25_aqi || aqi;
            break;
        case 'pm10_only':
            colorValue = pm10_aqi || aqi;
            break;
        case 'pm_avg':
            colorValue = Math.round(((pm25_aqi || 0) + (pm10_aqi || 0)) / 2) || aqi;
            break;
        // For other modes (aqi_only, aqi_pm25, aqi_avg), continue using aqi
        default:
            colorValue = aqi;
            break;
    }
    
    const aqiColor = getAQIColor(colorValue);
    
    // Determine display content based on configuration
    let displayContent = '';
    switch (CONFIG_AIR_QUALITY.DISPLAY_MODE) {
        case 'aqi_pm25':
            displayContent = `
                <div class="air-quality-display">
                    <div class="air-quality-main">${Math.round(aqi)}</div>
                    <div class="air-quality-sub">PM2.5: ${Math.round(pm25_aqi || 0)}</div>
                </div>
            `;
            break;
        case 'aqi_avg':
            const avgAqi = Math.round((pm25_aqi + pm10_aqi) / 2) || aqi;
            displayContent = `
                <div class="air-quality-display">
                    <div class="air-quality-main">${Math.round(aqi)}</div>
                    <div class="air-quality-sub">Avg: ${avgAqi}</div>
                </div>
            `;
            break;
        case 'pm25_only':
            displayContent = `<div class="air-quality-main">${Math.round(pm25_aqi || 0)}</div>`;
            break;
        case 'pm10_only':
            displayContent = `<div class="air-quality-main">${Math.round(pm10_aqi || 0)}</div>`;
            break;
        case 'pm_avg':
            const avgPM = Math.round(((pm25_aqi || 0) + (pm10_aqi || 0)) / 2);
            displayContent = `<div class="air-quality-main">${avgPM}</div>`;
            break;
        default: // 'aqi_only'
            displayContent = `<div class="air-quality-main">${Math.round(aqi)}</div>`;
            break;
    }
    
    const airQualityIcon = L.divIcon({
        html: `<div class="map-marker-air ${aqiColor}">${displayContent}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20],
        className: 'custom-air-quality-icon'
    });
    
    const marker = L.marker([location.lat, location.lon], {
        zIndexOffset: Z_INDEX_AIR_QUALITY,
        icon: airQualityIcon
    });
    
    // Create popup content
    const popupContent = createAirQualityPopupContent(location, aqi, pm25_aqi, pm10_aqi, locationData, measurementTime);
    marker.bindPopup(popupContent);
    
    // Store marker reference
    airQualityMarkers.push({
        marker: marker,
        location: location,
        aqi: aqi
    });
    
    // Add to layer
    airQualityLayer.addLayer(marker);
}

/**
 * Generates the HTML content for an air quality marker's popup.
 * 
 * @param {object} location - The geographic location data.
 * @param {number} aqi - The overall US AQI value.
 * @param {number|null} pm25_aqi - The PM2.5 AQI value.
 * @param {number|null} pm10_aqi - The PM10 AQI value.
 * @param {object} locationData - The full air quality data object for the location.
 * @param {Date} measurementTime - The specific time of this AQI measurement.
 * @returns {string} The HTML string for the popup content.
 */
function createAirQualityPopupContent(location, aqi, pm25_aqi, pm10_aqi, locationData, measurementTime) {
    const aqiDescription = getAQIDescription(aqi);
    const current = locationData.current || {};
    
    return `
        <div class="popup-content">
            <h3>${location.name} Air Quality</h3>
            <div class="popup-content-info">
                <span class="label">Overall AQI:</span><span class="value">${Math.round(aqi)} (${aqiDescription})</span>
                <span class="label">PM2.5 AQI:</span><span class="value">${pm25_aqi ? Math.round(pm25_aqi) : 'N/A'}</span>
                <span class="label">PM10 AQI:</span><span class="value">${pm10_aqi ? Math.round(pm10_aqi) : 'N/A'}</span>
                <span class="label">Rec. Time:</span><span class="value">${measurementTime.toLocaleString()}</span>
                <span class="label">Location:</span><span class="value">${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}</span>
            </div>
        </div>
    `;
}

/**
 * Custom icons for traffic data.
 */
const cameraIcon = L.divIcon({
    // KEYWORD custom_camera_icon
    html: '<div>📸</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
    className: 'map-marker-cameras'
});
const incidentIcon = L.divIcon({
    html: '<div>⚠️</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
    className: 'map-marker-incidents'
});

/**
 * Determines the appropriate fire icon number (1-5) based on incident type and containment.
 * 
 * @param {string} incidentType - The type of incident (e.g., 'RX' for prescribed fire).
 * @param {number|null|undefined} percentContained - The percentage of containment (0-100), or null/undefined if unknown.
 * @returns {number} An integer from 1 to 5, where 1 is fully contained and 5 is uncontained/prescribed.
 */
function getFireIconNumber(incidentType, percentContained) {
    // Prescribed fires get fire_5.svg (most intense)
    if (incidentType === 'RX') {
        return 5;
    }
    
    // For wildfires, determine containment level
    if (percentContained === null || percentContained === undefined) {
        return 5; // Unknown containment treated as not contained (fire_5.svg)
    }
    
    if (percentContained >= 100) {
        return 1; // Fully contained (fire_1.svg)
    } else if (percentContained >= 76) {
        return 2; // Mostly contained (fire_2.svg)
    } else if (percentContained >= 26) {
        return 3; // Partially contained (fire_3.svg)
    } else if (percentContained >= 10) {
        return 4; // Minimally contained (fire_4.svg)
    } else {
        return 5; // Not contained (fire_5.svg)
    }
}

/**
 * Determines a base size for a fire icon based on its acreage using a logarithmic scale,
 * with increased emphasis on larger fires while keeping small/mid sizes reasonable.
 * 
 * @param {number|null} acres - The acreage of the fire.
 * @returns {number} The base size in pixels.
 */
function getFireSize(acres) {
    if (!acres || acres <= 0) return 20;
    const minSize = 20;
    const maxSize = 100;
    const logAcres = Math.log10(acres);
    const clampedLog = Math.min(logAcres, 6);
    const adjustedLog = Math.pow(clampedLog / 6, 1.2); // slight nonlinear boost for upper range
    const scaledSize = minSize + adjustedLog * (maxSize - minSize);
    return Math.round(scaledSize);
}

/**
 * Calculates a zoom-responsive size for an icon.
 * The size scales up or down based on the current map zoom level relative to a base zoom.
 * 
 * @param {number} baseSize - The base size of the icon at the reference zoom level.
 * @param {number} currentZoom - The current zoom level of the map.
 * @returns {number} The calculated zoom-responsive size in pixels.
 */
function getZoomResponsiveSize(baseSize, currentZoom) {
    const baseZoom = 8; // Reference zoom level
    const scaleFactor = Math.pow(1.2, currentZoom - baseZoom);
    return Math.max(baseSize * scaleFactor, 16); // Minimum size of 16px
}

/**
 * Formats a Unix timestamp into a localized date and time string.
 * 
 * @param {number|null} timestamp - The Unix timestamp (in milliseconds) or null.
 * @returns {string} The formatted date/time string, or 'Unknown' if no timestamp.
 */
function formatFireDate(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

/**
 * Formats a numerical acreage value with commas and appends ' acres'.
 * 
 * @param {number|null} acres - The acreage value or null.
 * @returns {string} The formatted acreage string, or 'Unknown' if no acreage.
 */
function formatFireAcres(acres) {
    if (!acres || acres === null) return 'Unknown';
    return acres.toLocaleString() + ' acres';
}

/**
 * Creates the HTML content for a fire marker's popup.
 * Displays various attributes of the fire incident.
 * 
 * @param {object} fire - The fire incident object containing attributes and geometry.
 * @returns {string} The HTML string for the popup content.
 */
function createFirePopupContent(fire) {
    const attrs = fire.attributes;
    return `
        <div class="popup-content">
            <h3>${attrs.IncidentName || 'Unknown'} Fire</h3>
            <div class="popup-content-info">
                <span class="label">Type:</span><span class="value">${attrs.IncidentTypeCategory || 'Unknown'}</span>                    
                <span class="label">Daily Acres:</span><span class="value">${formatFireAcres(attrs.DailyAcres)}</span>
                <span class="label">Contained:</span><span class="value">${attrs.PercentContained ? attrs.PercentContained + '%' : 'Unknown'}</span>
                <span class="label">County:</span><span class="value">${attrs.POOCounty || 'Unknown'}</span>
                <span class="label">State:</span><span class="value">${attrs.POOState || 'Unknown'}</span>
                <span class="label">Cause:</span><span class="value">${attrs.FireCause || 'Unknown'}</span>
                <span class="label">Discovery:</span><span class="value">${formatFireDate(attrs.FireDiscoveryDateTime)}</span>
                <span class="label">Personnel:</span><span class="value">${attrs.TotalIncidentPersonnel || 'Unknown'}</span>
                <span class="label">Structures Destroyed:</span><span class="value">${(attrs.ResidencesDestroyed || 0) + (attrs.OtherStructuresDestroyed || 0)}</span>
                <span class="label">Injuries:</span><span class="value">${attrs.Injuries || 0}</span>
            </div>
        </div>
    `;
}

/**
 * Checks if a fire incident is located within the defined regional geographic bounds.
 * 
 * @param {object} fire - The fire incident object.
 * @returns {boolean} True if the fire is within the region, false otherwise.
 */
function isRegionFire(fire) {
    const state = fire.attributes.POOState;
    const lat = fire.geometry.y;
    const lng = fire.geometry.x;
    
    // Check if it's within our geographic bounds
    return state === 'US-OR' || (
        lat >= GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LAT && 
        lat <= GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LAT &&
        lng >= GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LNG && 
        lng <= GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LNG
    );
}

/**
 * Updates the size of all active fire icons on the map based on the current zoom level.
 */
function updateFireIconSizes() {
    const currentZoom = map.getZoom();
    
    // Update all fire markers
    fireMarkers.forEach(markerData => {
        const { marker, baseSize } = markerData;
        const newSize = getZoomResponsiveSize(baseSize, currentZoom);
        
        // Update the icon size
        const iconElement = marker.getElement();
        if (iconElement) {
            const svgElement = iconElement.querySelector('.fire-icon-svg');
            if (svgElement) {
                svgElement.style.width = newSize + 'px';
                svgElement.style.height = newSize + 'px';
            }
        }
    });
}

/**
 * Asynchronously loads fire incident data from a proxy.
 * Filters fires to the defined region and adds them as markers to the `fireLayer`.
 * Also populates `fireIncidentsData` for cross-referencing with perimeters.
 * 
 * @async
 * @returns {Promise<number>} A promise that resolves with the count of loaded fires.
 * @throws {Error} If there's an error during data fetching or processing.
 */
async function loadFireData() {
    if (isLoadingFires) return;
    
    isLoadingFires = true;

    try {
        const boundsStr = `${GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LNG},`
                + `${GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LAT},`
                + `${GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LNG},`
                + `${GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LAT}`;
        const response = await fetch(`${PROXY_API_ROOT}/fires?endpoint=incidents&bounds=${boundsStr}&firediscoveryage=${CONGIG_FIRE.DISCOVERY_AGE}&acreageoverride=${CONGIG_FIRE.ACRE_AGE_OVERRIDE}&excludefullycontained=${CONGIG_FIRE.EXCLUDE_FULLY_CONTAINED}`);

        const result = await response.json();
        const resultData = result.data || result;

        // Clear existing fire data and incident map
        fireLayer.clearLayers();
        fireMarkers = [];
        fireIncidentsData.clear();
        
        // Filter for region fires and add to map
        const regionFires = resultData.features.filter(isRegionFire);           
        if (regionFires.length === 0) {
            if (DEBUG) console.log('No fires found in the region');
            return 0;
        }
        
        let fireCount = 0;
        
        regionFires.forEach(fire => {
            const coords = fire.geometry;
            const attrs = fire.attributes;
            
            // Store incident data for cross-referencing with perimeters
            const fireKey = normalizeFireName(attrs.IncidentName);
            if (fireKey) {
                fireIncidentsData.set(fireKey, fire);
            }

            // Calculate base icon size based on fire acreage
            const baseSize = getFireSize(attrs.DailyAcres);
            const currentSize = getZoomResponsiveSize(baseSize, map.getZoom());
            
            // Get the appropriate fire icon number (1-5)
            const fireIconNumber = getFireIconNumber(attrs.IncidentTypeCategory, attrs.PercentContained);
            
            // Create custom div icon with SVG background
            const fireIcon = L.divIcon({
                className: 'map-marker-fire',
                html: `<div class="fire-icon-svg fire-${fireIconNumber}" style="width: ${currentSize}px; height: ${currentSize}px;"></div>`,
                iconSize: [currentSize, currentSize],
                iconAnchor: [currentSize / 2, currentSize / 2],
                popupAnchor: [0, -currentSize / 2]
            });
            
            // Create marker with custom icon
            const marker = L.marker([coords.y, coords.x], {
                zIndexOffset: Z_INDEX_FIRE,
                icon: fireIcon
            });
            
            // Add popup with fire information
            marker.bindPopup(createFirePopupContent(fire));
            
            // Store marker data for zoom updates
            fireMarkers.push({
                marker: marker,
                baseSize: baseSize,
                fireIconNumber: fireIconNumber,
                coords: [coords.y, coords.x]
            });
            
            // Add to fire layer
            fireLayer.addLayer(marker);
            fireCount++;
        });
        
        if (DEBUG) console.log(`Loaded ${fireCount} fires in region`);
        return fireCount;
        
    } catch (error) {
        if (DEBUG) console.error('Error loading fire data:', error);
        throw error;
    } finally {
        isLoadingFires = false;
    }
}

/**
 * Function to normalize fire names for matching (used for perimeters).
 * Converts to lowercase, replaces multiple spaces with single, removes non-alphanumeric, and trims.
 * 
 * @param {string} name - The fire name to normalize.
 * @returns {string} The normalized fire name.
 */
function normalizeFireName(name) {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '')
        .trim();
}

/**
 * Function to find matching incident data for a perimeter based on normalized names.
 * First attempts exact match, then partial matches.
 * 
 * @param {object} perimeterAttrs - The attributes of the fire perimeter.
 * @returns {object|null} The matching incident data object, or null if no match is found.
 */
function findMatchingIncident(perimeterAttrs) {
    const perimeterName = normalizeFireName(
        perimeterAttrs.IncidentName || 
        perimeterAttrs.FireName || 
        perimeterAttrs.INCIDENT_NAME || 
        perimeterAttrs.FIRE_NAME
    );
    
    if (!perimeterName) {
        if (DEBUG) console.log('Perimeter has no name to match:', perimeterAttrs);
        return null;
    }

    // Try to find exact match first
    for (let [key, incidentData] of fireIncidentsData) {
        const incidentName = normalizeFireName(incidentData.attributes.IncidentName);
        if (incidentName === perimeterName) {
            if (DEBUG) console.log(`Exact match found: "${perimeterName}" -> "${incidentName}"`);
            return incidentData;
        }
    }

    // Try partial matches (be more selective to avoid false positives)
    for (let [key, incidentData] of fireIncidentsData) {
        const incidentName = normalizeFireName(incidentData.attributes.IncidentName);
        if (incidentName && perimeterName && 
            incidentName.length > 3 && perimeterName.length > 3 && // Avoid matching very short names
            (incidentName.includes(perimeterName) || perimeterName.includes(incidentName))) {
            if (DEBUG) console.log(`Partial match found: "${perimeterName}" -> "${incidentName}"`);
            return incidentData;
        }
    }

    if (DEBUG) console.log(`No matching incident found for perimeter: "${perimeterName}"`);

    return null;
}

/**
 * Function to create perimeter popup content.
 * If a matching incident is found, it uses the incident's popup content.
 * Otherwise, it falls back to basic perimeter information.
 * 
 * @param {object} perimeter - The fire perimeter object.
 * @returns {string} The HTML string for the popup content.
 */
function createPerimeterPopupContent(perimeter) {
    const attrs = perimeter.attributes;
    
    // Try to find matching incident data
    const matchingIncident = findMatchingIncident(attrs);
    
    if (matchingIncident) {
        // Use incident popup content if we found a match
        return createFirePopupContent(matchingIncident);
    } else {
        // Fall back to basic perimeter info
        return `
            <div class="popup-content">
                <h3>${attrs.IncidentName || attrs.FireName || attrs.INCIDENT_NAME || 'Fire Perimeter'}</h3>
                <div class="popup-content-info">
                    <span class="label">GIS Acres:</span>
                    <span class="value">${formatFireAcres(attrs.GIS_ACRES || attrs.ACRES)}</span>
                    
                    <span class="label">Date Created:</span>
                    <span class="value">${formatFireDate(attrs.CreateDate || attrs.DATE_TIME)}</span>
                    
                    <span class="label">Source:</span>
                    <span class="value">${attrs.Source || attrs.DATA_SOURCE || 'Unknown'}</span>
                    
                    <span class="label">Fire Year:</span>
                    <span class="value">${attrs.FireYear || attrs.FIRE_YEAR || 'Unknown'}</span>
                    
                    <span class="label">Agency:</span>
                    <span class="value">${attrs.Agency || attrs.AGENCY || 'Unknown'}</span>
                    
                    <span class="label">Unit ID:</span>
                    <span class="value">${attrs.UnitID || attrs.UNIT_ID || 'Unknown'}</span>
                </div>
            </div>
        `;
    }
}

/**
 * Asynchronously loads fire perimeter data from a proxy.
 * Adds perimeters as polygon layers to the `firePerimeterLayer`.
 * 
 * @async
 * @returns {Promise<number>} A promise that resolves with the count of loaded perimeters.
 * @throws {Error} If there's an error during data fetching or processing.
 */
async function loadPerimeterData() {
    if (isLoadingPerimeters) return;
    
    isLoadingPerimeters = true;

    try {
        const boundsStr = `${GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LNG},`
                + `${GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LAT},`
                + `${GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LNG},`
                + `${GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LAT}`;
        const response = await fetch(`${PROXY_API_ROOT}/fires?endpoint=perimeters&bounds=${boundsStr}&firediscoveryage=${CONGIG_FIRE.DISCOVERY_AGE}&acreageoverride=${CONGIG_FIRE.ACRE_AGE_OVERRIDE}`);
        
        const result = await response.json();
        const resultData = result.data || result;

        firePerimeterLayer.clearLayers();
        
        if (resultData.features && resultData.features.length > 0) {
            // Filter for Oregon perimeters (if state info available)
            const firePermieters = resultData.features.filter(perimeter => {
                // Some perimeters might not have state info, so we'll include all in the bounding box
                return true;
            });
            
            let perimeterCount = 0;

            firePermieters.forEach(perimeter => {
                const geometry = perimeter.geometry;
                const attrs = perimeter.attributes;
                
                // **NEW: Only process perimeters that have matching incident data**
                const matchingIncident = findMatchingIncident(attrs);
                if (!matchingIncident) {
                    if (DEBUG) console.log(`Skipping perimeter without matching incident: ${attrs.IncidentName || attrs.FireName || 'Unknown'}`);
                    return; // Skip this perimeter if no matching incident found
                }
                
                // Handle different geometry types
                let layer;
                try {
                    if (geometry.type === 'Polygon') {
                        // GeoJSON format
                        const coordinates = geometry.coordinates;
                        if (coordinates && coordinates.length > 0) {
                            const latLngs = coordinates[0].map(coord => [coord[1], coord[0]]);
                            layer = L.polygon(latLngs, { pane: 'perimeterPane',
                                color: '#ff6b6b',
                                weight: 2,
                                opacity: 0.8,
                                fillColor: '#ff6b6b',
                                fillOpacity: 0.2,
                                zIndexOffset: Z_INDEX_FIRE_PERIMETER
                            });
                        }
                    } else if (geometry.type === 'MultiPolygon') {
                        // GeoJSON MultiPolygon
                        const coordinates = geometry.coordinates;
                        if (coordinates && coordinates.length > 0) {
                            const polygons = coordinates.map(polygon => 
                                polygon[0].map(coord => [coord[1], coord[0]])
                            );
                            layer = L.polygon(polygons, {
                                color: '#ff6b6b',
                                weight: 2,
                                opacity: 0.8,
                                fillColor: '#ff6b6b',
                                fillOpacity: 0.2,
                                zIndexOffset: Z_INDEX_FIRE_PERIMETER
                            });
                        }
                    } else if (geometry.rings && Array.isArray(geometry.rings)) {
                        // ArcGIS format with rings - handle multiple rings
                        const allRings = geometry.rings.map(ring => {
                            if (!Array.isArray(ring) || ring.length < 3) return null;
                            return ring.map(coord => {
                                if (!Array.isArray(coord) || coord.length < 2) return null;
                                return [coord[1], coord[0]]; // Convert [lng, lat] to [lat, lng]
                            }).filter(coord => coord !== null);
                        }).filter(ring => ring !== null && ring.length >= 3);
                        
                        if (allRings.length > 0) {
                            layer = L.polygon(allRings, {
                                color: '#ff6b6b',
                                weight: 2,
                                opacity: 0.8,
                                fillColor: '#ff6b6b',
                                fillOpacity: 0.2,
                                zIndexOffset: Z_INDEX_FIRE_PERIMETER
                            });
                        }
                    }
                } catch (error) {
                    if (DEBUG) console.error('Error processing perimeter geometry:', error, perimeter);
                }
                
                if (layer) {
                    // Add popup with perimeter information (will show incident data if match found)
                    layer.bindPopup(createPerimeterPopupContent(perimeter));
                    
                    // Add to perimeter layer
                    firePerimeterLayer.addLayer(layer);
                    perimeterCount++;
                }
            });
            
            if (DEBUG) console.log(`Loaded ${perimeterCount} fire perimeters with matching incidents`);
            return perimeterCount;
        } else {
            if (DEBUG) console.log('No perimeter features found');
            return 0;
        }
        
    } catch (error) {
        if (DEBUG) console.error('Error loading perimeter data:', error);
        throw error;
    } finally {
        isLoadingPerimeters = false;
    }
}


/**
 * Creates and appends a fullscreen image overlay to the document body.
 * Allows users to view images (e.g., camera feeds) in a larger, centered format.
 * 
 * @param {string} imageSrc - The URL of the image to display.
 * @param {string} altText - The alt text for the image.
 */
function createFullscreenImageOverlay(imageSrc, altText) {
    const overlay = document.createElement('div');
    overlay.className = 'image-fullscreen-overlay';
    
    const img = document.createElement('img');
    img.src = imageSrc;
    img.alt = altText;
    img.className = 'image-fullscreen';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'image-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.title = 'Close fullscreen';
    
    // Close handlers
    const closeOverlay = () => {
        document.body.removeChild(overlay);
        document.body.style.overflow = 'auto';
        document.removeEventListener('keydown', handleKeyPress); // Remove key listener when closing
    };
    
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeOverlay();
    });
    
    overlay.addEventListener('click', closeOverlay);
    
    // Prevent closing when clicking on the image
    img.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    // ESC key to close
    const handleKeyPress = (e) => {
        if (e.key === 'Escape') {
            closeOverlay();
        }
    };
    document.addEventListener('keydown', handleKeyPress);
    
    overlay.appendChild(img);
    overlay.appendChild(closeBtn);
    
    // Prevent body scrolling when overlay is open
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
}

/**
 * Fetches traffic data from a specified endpoint via a proxy.
 * 
 * @async
 * @param {string} endpoint - The traffic data endpoint ('incidents' or 'cameras').
 * @returns {Promise<Array<object>|object>} A promise that resolves with the fetched traffic data.
 * @throws {Error} If the fetch operation fails or the proxy returns an error status.
 */
async function fetchTrafficData(endpoint) {
    try {
        const boundsStr = (endpoint == 'incidents')
            ? `${GEO_CONSTANTS.CENTRAL_OREGON_BOUNDS.SOUTHWEST_LNG},`
                + `${GEO_CONSTANTS.CENTRAL_OREGON_BOUNDS.SOUTHWEST_LAT},`
                + `${GEO_CONSTANTS.CENTRAL_OREGON_BOUNDS.NORTHEAST_LNG},`
                + `${GEO_CONSTANTS.CENTRAL_OREGON_BOUNDS.NORTHEAST_LAT}`
            : `${GEO_CONSTANTS.OREGON_CAMERA_BOUNDS.SOUTHWEST_LNG},`
                + `${GEO_CONSTANTS.OREGON_CAMERA_BOUNDS.SOUTHWEST_LAT},`
                + `${GEO_CONSTANTS.OREGON_CAMERA_BOUNDS.NORTHEAST_LNG},`
                + `${GEO_CONSTANTS.OREGON_CAMERA_BOUNDS.NORTHEAST_LAT}`;
        const eventTypes = (endpoint == 'incidents')
            ? `&eventtypes=${CONFIG_OREGON_TRAFFIC.EVENT_TYPES}&eventsubtypes=${CONFIG_OREGON_TRAFFIC.EVENT_SUBTYPES}`
            : '';
        const response = await fetch(`${PROXY_API_ROOT}/oregon-traffic?data=${endpoint}&bounds=${boundsStr}${eventTypes}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        const resultData = result;

        if (DEBUG) console.log(`Traffic API Response for ${endpoint}:`, resultData);
        
        if (resultData.status === 'success') {
            if (resultData.data && typeof resultData.data === 'object') {
                if (endpoint === 'incidents' && resultData.data.incidents) {
                    return resultData.data.incidents;
                }
                if (endpoint === 'cameras' && resultData.data.CCTVInventoryRequest) {
                    return resultData.data.CCTVInventoryRequest;
                }
                if (Array.isArray(resultData.data)) {
                    return resultData.data;
                }
                const dataKeys = Object.keys(resultData.data);
                for (const key of dataKeys) {
                    if (Array.isArray(resultData.data[key])) {
                        return resultData.data[key];
                    }
                }
                return resultData.data;
            }
            return resultData.data;
        } else {
            throw new Error(result.message || 'Failed to fetch traffic data');
        }
    } catch (error) {
        if (DEBUG) console.error(`Error fetching ${endpoint}:`, error);
        throw error;
    }
}

/**
 * Asynchronously loads traffic camera data and adds them as markers to the `cameraLayer`.
 * Filters cameras to the defined regional bounds.
 * 
 * @async
 * @returns {Promise<number>} A promise that resolves with the count of loaded cameras.
 * @throws {Error} If there's an error during data fetching or processing.
 */
async function loadCameras() {
    try {
        const cameras = await fetchTrafficData('cameras');
        cameraLayer.clearLayers(); // Clear previous markers

        let count = 0;
        if (cameras && Array.isArray(cameras)) {
            cameras.forEach((camera, index) => {
                const lat = parseFloat(camera['latitude']);
                const lng = parseFloat(camera['longitude']);
                                        
                if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                    if (lat >= GEO_CONSTANTS.OREGON_CAMERA_BOUNDS.SOUTHWEST_LAT && 
                        lat <= GEO_CONSTANTS.OREGON_CAMERA_BOUNDS.NORTHEAST_LAT &&
                        lng >= GEO_CONSTANTS.OREGON_CAMERA_BOUNDS.SOUTHWEST_LNG && 
                        lng <= GEO_CONSTANTS.OREGON_CAMERA_BOUNDS.NORTHEAST_LNG) {
                        
                        const marker = L.marker([lat, lng], { 
                            // zIndexOffset is not typically used with MarkerClusterGroup as it manages z-index internally
                            icon: cameraIcon 
                        });
                        const imageUrl = camera['cctv-url'];                               
                        const imageId = `camera-img-${camera.Id || index}`;
                        
                        let popupContent = `<div class="popup-content">`;
                        
                        if (imageUrl) {
                            popupContent += `
                                <div class="popup-camera-container">
                                    <img id="${imageId}" src="${imageUrl}" alt="Live camera view" class="popup-camera" 
                                            onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
                                            title="Click to view fullscreen"
                                            data-fullscreen-url="${imageUrl}">
                                    <div style="display: none;">Camera image unavailable</div>
                                </div>
                            `;
                        } else {
                            popupContent += `
                                <div class="popup-detail" style="font-style: italic; margin: 1.0rem;">No camera image available</div>
                            `;
                        }
                        
                        popupContent += `</div>`;
                        marker.bindPopup(popupContent, { 
                            maxWidth: 350, 
                            className: 'camera-img'
                        });
                        
                        marker.on('popupopen', function() {
                            const img = document.getElementById(imageId);
                            if (img) {
                                img.addEventListener('click', function() {
                                    const url = this.getAttribute('data-fullscreen-url');
                                    if (url) {
                                        createFullscreenImageOverlay(url, 'Live camera view');
                                    }
                                });
                            }
                        });
                        
                        cameraLayer.addLayer(marker);
                        count++;
                    }
                }
            });
        }

        return count;
    } catch (error) {
        if (DEBUG) console.error('Error loading cameras:', error);
        throw error;
    }
}

/**
 * Asynchronously loads traffic incident data and adds them as markers to the `incidentLayer`.
 * Filters incidents to the defined regional bounds.
 * 
 * @async
 * @returns {Promise<number>} A promise that resolves with the count of loaded incidents.
 * @throws {Error} If there's an error during data fetching or processing.
 */
async function loadIncidents() {
    try {
        const incidents = await fetchTrafficData('incidents');
        incidentLayer.clearLayers();
        
        if (DEBUG) console.log('Incidents data:', incidents);
        
        let count = 0;
        if (incidents && Array.isArray(incidents)) {
            incidents.forEach((incident, index) => {
                if (DEBUG && index < 3) {
                    console.log(`Incident ${index}:`, incident);
                }
                
                const lat = incident.location?.['start-location']?.['start-lat'];
                const lng = incident.location?.['start-location']?.['start-long'];
                
                if (DEBUG) console.log(`Incident ${index} coordinates: lat=${lat}, lng=${lng}`);
                
                if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                    if (lat >= GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LAT && 
                        lat <= GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LAT &&
                        lng >= GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LNG && 
                        lng <= GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LNG) {
                        
                        const marker = L.marker([lat, lng], { 
                            zIndexOffset: Z_INDEX_INCIDENT,
                            icon: incidentIcon 
                        });
                        
                        const incidentId = incident['incident-id'] || 'Unknown';
                        const eventType = incident['event-type-id'] || 'Unknown';
                        const headline = incident['headline'] || 'No headline available';
                        const comments = incident['comments'] || 'No additional comments';
                        const impactDesc = incident['impact-desc'] || 'Unknown impact';
                        const isActive = incident['is-active'] === 'true' ? 'Active' : 'Inactive';
                        
                        const locationName = incident.location?.['location-name'] || 'Unknown location';
                        const routeId = incident.location?.['route-id'] || 'N/A';
                        const hwyId = incident.location?.['hwy-id'] || 'N/A';
                        const locationDesc = incident.location?.['start-location']?.['location-desc'] || 'No description';
                        
                        const updateTime = incident['update-time'] 
                            ? new Date(incident['update-time']).toLocaleString()
                            : 'Unknown';
                        
                        const createTime = incident['create-time']
                            ? new Date(incident['create-time']).toLocaleString()
                            : 'Unknown';

                        const popupContent = `
                            <div class="popup-content">
                                <h3>Traffic Alert #${incidentId}</h3>
                                <p>${headline}</p>
                                <div class="popup-content-info">
                                    <span class="label">Status:</span><span class="value">${isActive}</span>
                                    <span class="label">Type:</span><span class="value">${eventType}</span>
                                    <span class="label">Highway:</span><span class="value">${routeId} (${hwyId})</span>
                                    <span class="label">Location:</span><span class="value">${locationName}</span>
                                    <span class="label">Description:</span><span class="value">${locationDesc}</span>
                                    <span class="label">Impact:</span><span class="value">${impactDesc}</span>
                                    <span class="label">Created:</span><span class="value">${createTime}</span>
                                    <span class="label">Last Update:</span><span class="value">${updateTime}</span>
                                </div>
                            </div>
                        `;
                        
                        marker.bindPopup(popupContent, { maxWidth: 350 });
                        incidentLayer.addLayer(marker);
                        count++;
                    }
                }
            });
        }
        
        if (DEBUG) console.log(`Loaded ${count} incidents within bounds out of ${incidents ? incidents.length : 0} total`);
        return count;
    } catch (error) {
        if (DEBUG) console.error('Error loading incidents:', error);
        incidentCountGlobal = 0;
        updateIncidentToggleState();
        throw error;
    }
}

/**
 * Asynchronously loads all auxiliary data layers: traffic cameras, incidents, fire data, fire perimeters, and air quality data.
 * This function aggregates calls to individual loading functions and updates the UI accordingly.
 * 
 * @async
 */
async function loadAllTrafficAndFireData() {

    if (isLoadingTraffic) return;
    
    isLoadingTraffic = true;
    
    try {
        const promises = [];
        let cameraCount = 0;
        let incidentCount = 0;
        let fireCount = 0;
        let perimeterCount = 0;
        let airQualityCount = 0;
        
        if (showCameras) {
            promises.push(loadCameras().then(count => cameraCount = count));
        }
        
        if (showIncidents) {
            promises.push(loadIncidents().then(count => incidentCount = count));
        }
        
        // Load fire incidents first so their data is available for perimeter matching
        promises.push(loadFireData().then(count => fireCount = count));

        // Load perimeters after incidents so fireIncidentsData is populated
        promises.push(loadPerimeterData().then(count => perimeterCount = count));
        
        // Only load air quality if it's explicitly enabled in config
        if (CONFIG_AIR_QUALITY.UPDATE_WITH_TIME) {
            promises.push(loadAirQualityData().then(count => {
                airQualityCount = count;
                // Show AQI toggle and legend item only if AQI data is configured to load
                document.getElementById('airQualityToggleGroup').style.display = 'flex';
                document.getElementById('airQualityLegendItem').style.display = 'flex';
            }));
        } else {
            // Hide AQI toggle and legend if not configured
            document.getElementById('airQualityToggleGroup').style.display = 'none';
            document.getElementById('airQualityLegendItem').style.display = 'none';
            showAirQuality = false; // Ensure the internal state is consistent
        }
        
        // show the controls now
        document.getElementById('controls').style.display = 'block';
        
        // and wait
        await Promise.all(promises);
        
        // Update global incident count and button state
        incidentCountGlobal = incidentCount;
        updateIncidentToggleState();

        if (DEBUG) console.log(`Data loaded: ${cameraCount} cameras, ${incidentCount} incidents, ${fireCount} fires, ${perimeterCount} perimeters, ${airQualityCount} air quality stations`);
        
    } catch (error) {
        if (DEBUG) console.error('Error loading traffic and fire data:', error);
    } finally {
        isLoadingTraffic = false;
    }
}

/**
 * Generates an array of time extent objects based on `CONFIG` parameters.
 * Each object represents a time slice for smoke forecast data,
 * including start/end timestamps, hour offset, and formatted datetime.
 * Updates the `timeExtents` global variable.
 * 
 * @returns {Array<object>} The array of generated time extent objects.
 */
function generateTimeExtents() {
    const currentTime = Date.now();
    const hourInMs = 60 * 60 * 1000;
    const startTime = currentTime + (CONFIG_SMOKE.START_HOURS_OFFSET * hourInMs);
    
    timeExtents = [];
    for (let i = 0; i < CONFIG_SMOKE.DURATION_HOURS; i += CONFIG_SMOKE.HOUR_INTERVAL) {
        const timeStart = startTime + (i * hourInMs);
        const timeEnd = startTime + ((i + CONFIG_SMOKE.HOUR_INTERVAL) * hourInMs);
        const relativeHour = CONFIG_SMOKE.START_HOURS_OFFSET + i;
        
        timeExtents.push({
            start: timeStart,
            end: timeEnd,
            hour: i,
            relativeHour: relativeHour,
            datetime: new Date(timeStart).toLocaleString(),
            isPast: relativeHour < 0,
            isFuture: relativeHour > 0,
            isNow: relativeHour === 0
        });
    }
    
    totalHours = timeExtents.length;
    updateSliderBackground();

    if (DEBUG) {
        console.log(`Generated ${timeExtents.length} time periods:`);
        console.log(`  Start: ${timeExtents[0].datetime} (${timeExtents[0].relativeHour}h)`);
        console.log(`  End: ${timeExtents[timeExtents.length - 1].datetime} (${timeExtents[timeExtents.length - 1].relativeHour}h)`);
    }
    
    return timeExtents;
}

/**
 * Initiates the progressive loading process for all data layers.
 * This includes initial loading of traffic, fire, and air quality data,
 * followed by sequential loading of smoke forecast layers.
 * Manages loading UI updates (progress bar, details).
 * 
 * @async
 */
async function startProgressiveLoading() {
    document.getElementById('progressContainer').style.display = 'block';
    document.getElementById('loadButton').style.display = 'none';
    
    loadingErrors = [];
    loadedCount = 0;
    errorCount = 0;
    shouldContinueLoading = true;
    activeRequests = 0;
    isProgressiveLoading = true;
    progressiveLoadingIndex = 0;
    availableLayerCount = 0;
    allDataLoaded = false;
    
    setSpeedControlEnabled(false);
    
    try {
        generateTimeExtents();
        smokeLayers = new Array(timeExtents.length);
        initializeTimeControls();
        updateLoadingProgress(5);
        
        // Load traffic, fire, and air quality data first
        updateLoadingDetails('Loading traffic, fire, and air quality data...');
        // turn off a few things to keep the loading modal minimal
        document.getElementById('loadingTitle').style.display = 'none';
        document.getElementById('loadingDisclaimer').style.display = 'none';
        await loadAllTrafficAndFireData();
        
        // Then start progressive smoke data loading
        startProgressiveDataLoad();
        
        setTimeout(() => {
            const loadingEl = document.getElementById('loading');
            loadingEl.classList.add('status');
        }, 1000);
        
    } catch (error) {
        if (DEBUG) console.error('Error starting progressive loading:', error);
        updateLoadingProgress(0);
        showErrorLog();
    }
}

/**
 * Manages the sequential, progressive loading of smoke forecast data layers.
 * Iterates through `timeExtents`, fetches data for each time slice, and updates the loading UI.
 * Includes retry logic for failed requests and a small delay between requests.
 * Automatically starts animation once a few layers are loaded.
 * 
 * @async
 */
async function startProgressiveDataLoad() {
    for (let i = 0; i < timeExtents.length && shouldContinueLoading; i++) {
        const timeExtent = timeExtents[i];
        const progress = 10 + (i / timeExtents.length) * 85;
        
        const timeType = timeExtent.isPast ? 'Past' : (timeExtent.isFuture ? 'Future' : 'Current');
        updateLoadingProgress(progress);
        updateLoadingDetails(`Loading ${timeExtent.relativeHour >= 0 ? '+' : ''}${timeExtent.relativeHour}h smoke data`);
        
        try {
            if (DEBUG) console.log(`Loading smoke data for hour ${i + 1}:`, timeExtent.datetime, `(${timeExtent.relativeHour}h)`);
            const layerData = await loadSmokeDataForTimeWithRetry(timeExtent, i);
            
            if (layerData && layerData.layer) {
                smokeLayers[i] = layerData;
                loadedCount++;
                availableLayerCount++;
                if (DEBUG) console.log(`✓ Layer ${i + 1} loaded: ${layerData.featureCount} features (${timeExtent.relativeHour}h)`);
                
                if (availableLayerCount === 1) {
                    showTimeIndex(i);
                    document.getElementById('timeSlider').value = i;
                    currentTimeIndex = i;
                }
                
                if (availableLayerCount === 3 && !isAnimating) {
                    setTimeout(() => {
                        startAnimation();
                    }, 1000);
                }
            } else {
                if (DEBUG) console.warn(`⚠ No smoke data for hour ${i + 1} (${timeExtent.relativeHour}h)`);
                smokeLayers[i] = null;
            }
        } catch (error) {
            if (DEBUG) console.error(`✗ Failed to load smoke data for hour ${i + 1} (${timeExtent.relativeHour}h):`, error);
            const errorMsg = `Hour ${i + 1} (${timeExtent.relativeHour >= 0 ? '+' : ''}${timeExtent.relativeHour}h): ${error.message}`;
            loadingErrors.push(errorMsg);
            errorCount++;
            
            smokeLayers[i] = null;                                
            updateErrorLog();
        }
        
        progressiveLoadingIndex = i + 1;
        
        if (i < timeExtents.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }
    
    updateLoadingProgress(100);
    isProgressiveLoading = false;
    allDataLoaded = true;
    setSpeedControlEnabled(true);
    
    setTimeout(() => {
        document.getElementById('loading').classList.add('hidden');
    }, 2000);
}

/**
 * Enables or disables the animation speed control dropdown.
 * 
 * @param {boolean} enabled - True to enable, false to disable.
 */
function setSpeedControlEnabled(enabled) {
    const speedControlContainer = document.getElementById('speedControlContainer');
    const speedSelect = document.getElementById('speedSelect');
    
    if (enabled) {
        speedControlContainer.classList.remove('disabled');
        speedSelect.disabled = false;
    } else {
        speedControlContainer.classList.add('disabled');
        speedSelect.disabled = true;
    }
}

/**
 * Shows the first available smoke layer on the map after loading.
 * If no smoke layers are available, it attempts to fit the map bounds to a default region.
 */
function showInitialTime() {
    for (let i = 0; i < smokeLayers.length; i++) {
        if (smokeLayers[i] && smokeLayers[i].layer) {
            showTimeIndex(i);
            document.getElementById('timeSlider').value = i;
            if (DEBUG) console.log(`Starting at first available index ${i} (${timeExtents[i].relativeHour}h from now)`);
            return;
        }
    }

    if (smokeLayers.some(layer => layer && layer.layer)) { // This condition seems redundant with the loop above
        const centerBounds = [
            [GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LAT, GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LNG],
            [GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LAT, GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LNG]
        ];
        
        setTimeout(() => {
            map.fitBounds(centerBounds, { 
                padding: [20, 20],
                maxZoom: GEO_CONSTANTS.INITIAL_ZOOM
            });
        }, 1000);
    }
}

/**
 * Loads smoke data for a specific time extent with retry attempts.
 * Implements a basic retry mechanism with increasing delays and a timeout.
 * 
 * @async
 * @param {object} timeExtent - The time extent object for which to load data.
 * @param {number} index - The index of the time extent in the `timeExtents` array.
 * @param {number} [maxRetries=2] - The maximum number of retry attempts.
 * @returns {Promise<object|null>} A promise that resolves with the loaded layer data, or null if no data.
 * @throws {Error} If all retry attempts fail or loading is cancelled.
 */
async function loadSmokeDataForTimeWithRetry(timeExtent, index, maxRetries = 2) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (!shouldContinueLoading) {
                throw new Error('Loading cancelled by user');
            }
            
            activeRequests++;
            if (DEBUG) console.log(`Attempt ${attempt}/${maxRetries} for hour ${index + 1}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                if (DEBUG) console.log(`Timeout for hour ${index + 1}, attempt ${attempt}`);
                controller.abort();
            }, 30000);
            
            const layerData = await loadSmokeDataForTime(timeExtent, controller.signal);
            clearTimeout(timeoutId);
            activeRequests--;
            return layerData;
            
        } catch (error) {
            activeRequests--;
            lastError = error;
            if (DEBUG) console.warn(`Attempt ${attempt}/${maxRetries} failed for hour ${index + 1}:`, error.message);
            
            if (attempt < maxRetries) {
                const delay = 1000 * attempt;
                if (DEBUG) console.log(`Waiting ${delay}ms before retry for hour ${index + 1}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

/**
 * Asynchronously fetches smoke forecast data for a given time extent from a proxy.
 * Parses the ESRI JSON geometry and converts it to GeoJSON for Leaflet.
 * Creates a Leaflet GeoJSON layer with custom styling and popups.
 * 
 * @async
 * @param {object} timeExtent - The time extent object defining the forecast period.
 * @param {AbortSignal} [abortSignal=null] - An AbortSignal to cancel the fetch request.
 * @returns {Promise<object|null>} A promise that resolves with an object containing the Leaflet layer,
 * time extent, and feature count, or null if no valid features.
 * @throws {Error} If the fetch fails, response is invalid, or layer creation fails.
 */
async function loadSmokeDataForTime(timeExtent, abortSignal = null) {
    const timeStart = timeExtent.start;
    const timeEnd = timeExtent.end;
    const boundsStr = `${GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LNG},`
            + `${GEO_CONSTANTS.REGION_BOUNDS.SOUTHWEST_LAT},`
            + `${GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LNG},`
            + `${GEO_CONSTANTS.REGION_BOUNDS.NORTHEAST_LAT}`;
    let url = `${PROXY_API_ROOT}/smoke?timeStart=${timeStart}&timeEnd=${timeEnd}`;
    // Nationwide? If not, do bounds
    url += (NATIONWIDE)
        ? `&nationwide=true`
        : `&bounds=${boundsStr}`;

    const fetchOptions = {
        method: 'GET',
        headers: {'Accept': 'application/json'},
        cache: 'no-cache'
    };
    
    if (abortSignal) {
        fetchOptions.signal = abortSignal;
    }
    
    if (DEBUG) console.log(`Fetching smoke data from: ${url}`);
    const response = await fetch(url, fetchOptions);
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const responseText = await response.text();
    
    if (!responseText) {
        throw new Error('Empty response from server');
    }

    let resultData;
    try {
        resultData = JSON.parse(responseText);
    } catch (parseError) {
        if (DEBUG) {
            console.error('JSON parse error:', parseError);
            console.error('Response text:', responseText.substring(0, 500));
        }
        throw new Error('Invalid JSON response from server');
    }
    
    if (resultData.error) {
        throw new Error(resultData.error);
    }
    
    if (resultData.features && resultData.features.length > 0) {
        if (DEBUG) console.log(`Processing ${resultData.features.length} smoke features for time period`);
        
        if (DEBUG) {
            for (let i = 0; i < Math.min(3, resultData.features.length); i++) {
                const feature = resultData.features[i];
                if (feature.geometry) {
                    if (feature.geometry.x !== undefined && feature.geometry.y !== undefined) {
                        console.log(`Feature ${i} coords: x=${feature.geometry.x}, y=${feature.geometry.y} (${isWebMercatorCoordinate(feature.geometry.x, feature.geometry.y) ? 'Web Mercator' : 'Geographic'})`);
                    } else if (feature.geometry.rings && feature.geometry.rings[0] && feature.geometry.rings[0][0]) {
                        const coord = feature.geometry.rings[0][0];
                        console.log(`Feature ${i} coords: x=${coord[0]}, y=${coord[1]} (${isWebMercatorCoordinate(coord[0], coord[1]) ? 'Web Mercator' : 'Geographic'})`);
                    }
                }
            }
        }
        
        const validFeatures = [];
        
        for (const feature of resultData.features) {
            try {
                const geometry = convertEsriGeometry(feature.geometry);
                
                if (geometry && isValidGeometry(geometry)) {
                    validFeatures.push({
                        type: "Feature",
                        properties: feature.attributes || {},
                        geometry: geometry
                    });
                } else {
                    if (DEBUG) console.warn('Invalid geometry found, skipping feature:', feature);
                }
            } catch (geomError) {
                if (DEBUG) console.warn('Error processing feature geometry:', geomError, feature);
            }
        }
        
        if (validFeatures.length === 0) {
            if (DEBUG) console.warn('No valid smoke features found after processing');
            return null;
        }
        
        const geoJsonData = {
            type: "FeatureCollection",
            features: validFeatures
        };
        
        try {
            const layer = L.geoJSON(geoJsonData, { pane: 'smokePane',
                style: smokeStyle,
                onEachFeature: function(feature, layer) {
                    const popupContent = createSmokePopupContent(feature.properties, timeExtent);
                    layer.bindPopup(popupContent);
                }
            });

            return {
                layer: layer,
                timeExtent: timeExtent,
                featureCount: validFeatures.length
            };
        } catch (layerError) {
            if (DEBUG) console.error('Error creating Leaflet layer:', layerError);
            throw new Error('Failed to create map layer: ' + layerError.message);
        }
    }
    
    if (DEBUG) console.log(`No smoke features found for time period: ${timeExtent.datetime}`);
    return null;
}

/**
 * Updates the incident button to not work if there are no incidents
 */
function updateIncidentToggleState() {
    const toggleIncidentsBtn = document.getElementById('toggleIncidents');
    const incidentLegend = document.getElementById('legend-incident-icon');
    
    if (incidentCountGlobal === 0) {
        // Disable the button
        toggleIncidentsBtn.classList.add('disabled');
        toggleIncidentsBtn.disabled = true;
        toggleIncidentsBtn.innerHTML = 'No Incidents';
        
        // Hide incidents legend item
        incidentLegend.classList.add('disabled');
        
        // Hide incidents layer if it's currently shown
        if (showIncidents) {
            showIncidents = false;
            toggleLayer(incidentLayer, false);
        }
    } else {
        // Show incidents legend item
        incidentLegend.classList.remove('disabled');

        // Enable the button
        toggleIncidentsBtn.classList.remove('disabled');
        toggleIncidentsBtn.disabled = false;
        updateToggleText(toggleIncidentsBtn, showIncidents);
    }
}

/**
 * Checks if a given X, Y coordinate pair is likely in Web Mercator projection.
 * Web Mercator coordinates typically have absolute values much larger than geographic (lat/lng) coordinates.
 * 
 * @param {number} x - The X coordinate.
 * @param {number} y - The Y coordinate.
 * @returns {boolean} True if the coordinates appear to be in Web Mercator, false otherwise.
 */
function isWebMercatorCoordinate(x, y) {
    return Math.abs(x) > 180 || Math.abs(y) > 90;
}

/**
 * Validates a GeoJSON-like geometry object to ensure it has a valid structure and finite coordinates within standard ranges.
 * Specifically checks Polygon coordinates for valid rings and coordinate values.
 * 
 * @param {object} geometry - The GeoJSON-like geometry object.
 * @returns {boolean} True if the geometry is considered valid, false otherwise.
 */
function isValidGeometry(geometry) {
    if (!geometry || !geometry.type) {
        return false;
    }
    
    if (geometry.type === 'Polygon') {
        if (!geometry.coordinates || !Array.isArray(geometry.coordinates)) {
            return false;
        }
        
        for (const ring of geometry.coordinates) {
            if (!Array.isArray(ring) || ring.length < 4) { // Polygons need at least 4 points (closed ring)
                return false;
            }
            
            for (const coord of ring) {
                if (!Array.isArray(coord) || coord.length < 2) {
                    return false;
                }
                
                const lng = coord[0];
                const lat = coord[1];
                
                if (typeof lng !== 'number' || typeof lat !== 'number' ||
                    lng < -180 || lng > 180 || lat < -90 || lat > 90) {
                    return false;
                }
                
                if (!isFinite(lng) || !isFinite(lat)) {
                    return false;
                }
            }
        }
        
        return true;
    } else if (geometry.type === 'LineString') {
            if (!geometry.coordinates || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
            return false;
        }
            for (const coord of geometry.coordinates) {
            if (!Array.isArray(coord) || coord.length < 2 || !isFinite(coord[0]) || !isFinite(coord[1])) {
                return false;
            }
            }
            return true;
    } else if (geometry.type === 'Point') {
        if (!geometry.coordinates || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || !isFinite(geometry.coordinates[0]) || !isFinite(geometry.coordinates[1])) {
            return false;
        }
        return true;
    }
    
    return true; // For other geometry types, assume valid if structure is basic
}

/**
 * Updates the time slider background to reflect the past/future breakdown
 */
function updateSliderBackground() {
    const slider = document.getElementById('timeSlider');
    
    if (timeExtents.length === 0) return;
    
    // Find the index where time transitions from past to future (relativeHour >= 0)
    let pastEndIndex = -1;
    for (let i = 0; i < timeExtents.length; i++) {
        if (timeExtents[i].relativeHour < 0) {
            pastEndIndex = i;
        } else {
            break;
        }
    }
    
    // Calculate the percentage where past ends
    const pastPercentage = pastEndIndex >= 0 ? 
        ((pastEndIndex + 1) / timeExtents.length) * 100 : 0;
    
    // Update the CSS custom property for the gradient
    slider.style.setProperty('--past-percentage', `${pastPercentage}%`);
}

/**
 * Initializes the time slider control, setting its max value and updating labels.
 * If `timeExtents` is empty, it first calls `generateTimeExtents`.
 */
function initializeTimeControls() {
    if (timeExtents.length === 0) {
        generateTimeExtents();
    }
    
    const slider = document.getElementById('timeSlider');
    slider.max = timeExtents.length - 1;
    slider.value = 0;
    
    updateTimeDisplay(0);
    updateSliderLabels();
    updateSliderBackground();
}

/**
 * Updates the text content of the time slider's start and end labels
 * to reflect the relative hours of the first and last time extents.
 */
function updateSliderLabels() {
    const startLabel = document.getElementById('sliderStartLabel');
    const endLabel = document.getElementById('sliderEndLabel');
    
    if (timeExtents.length > 0) {
        const firstTime = timeExtents[0];
        const lastTime = timeExtents[timeExtents.length - 1];
        
        startLabel.textContent = `${firstTime.relativeHour >= 0 ? '+' : ''}${firstTime.relativeHour}h`;
        endLabel.textContent = `${lastTime.relativeHour >= 0 ? '+' : ''}${lastTime.relativeHour}h`;
    }
}

/**
 * Displays the smoke layer for a specific time index on the map, and hides all other smoke layers.
 * Updates the `currentTimeIndex` and the time display.
 * Also triggers an update of air quality markers if `CONFIG_AIR_QUALITY.UPDATE_WITH_TIME` is true.
 * 
 * @param {number} index - The index of the time extent (and corresponding smoke layer) to display.
 */
function showTimeIndex(index) {
    // Remove existing smoke layers
    smokeLayers.forEach((layerData, i) => {
        if (layerData && layerData.layer && map.hasLayer(layerData.layer)) {
            map.removeLayer(layerData.layer);
        }
    });
    
    // Add new smoke layer if visible and available
    if (showSmoke && smokeLayers[index] && smokeLayers[index].layer) {
        try {
            smokeLayers[index].layer.addTo(map);
            if (DEBUG) console.log(`Showing smoke time index ${index}:`, timeExtents[index].datetime, `(${timeExtents[index].relativeHour}h)`);
        } catch (error) {
            if (DEBUG) console.error('Error adding smoke layer to map:', error);
        }
    }
    
    currentTimeIndex = index;
    updateTimeDisplay(index);
    
    // Update air quality markers if enabled
    if (showAirQuality && CONFIG_AIR_QUALITY.UPDATE_WITH_TIME) {
        updateAirQualityMarkers();
    }
}

/**
 * Event handler for when the time slider's value changes.
 * Calls `showTimeIndex` to update the displayed smoke layer and air quality markers.
 */
function onTimeSliderChange() {
    const slider = document.getElementById('timeSlider');
    const index = parseInt(slider.value);
    
    if (smokeLayers[index] && smokeLayers[index].layer) {
        showTimeIndex(index);
    } else {
        updateTimeDisplay(index);
        const timeDisplay = document.getElementById('currentTimeDisplay');
        timeDisplay.style.opacity = '0.6';
        setTimeout(() => {
            timeDisplay.style.opacity = '1';
        }, 500);
        
        // Still update air quality even if no smoke data
        if (showAirQuality && CONFIG_AIR_QUALITY.UPDATE_WITH_TIME) {
            currentTimeIndex = index;
            updateAirQualityMarkers();
        }
    }
}

/**
 * Toggles the animation of smoke layers (play/pause).
 */
function toggleAnimation() {
    if (isAnimating) {
        stopAnimation();
    } else {
        startAnimation();
    }
}

/**
 * Starts the animation of smoke layers, cycling through available time steps.
 * Updates the play/pause button state.
 * Does nothing if smoke layer is hidden.
 */
function startAnimation() {
    if (isAnimating) return;
    
    // Don't start animation if smoke is hidden
    if (!showSmoke) {
        if (DEBUG) console.log('Cannot start animation: smoke layer is hidden');
        return;
    }
    
    isAnimating = true;
    const playButton = document.getElementById('playButton');
    playButton.innerHTML = '<span>||</span> Pause';
    playButton.classList.add('playing');
    
    animationInterval = setInterval(() => {
        const availableIndices = [];
        for (let i = 0; i < smokeLayers.length; i++) {
            if (smokeLayers[i] && smokeLayers[i].layer) {
                availableIndices.push(i);
            }
        }
        
        if (availableIndices.length === 0) {
            stopAnimation();
            return;
        }
        
        const currentAvailableIndex = availableIndices.indexOf(currentTimeIndex);
        let nextAvailableIndex;
        
        if (currentAvailableIndex === -1) {
            nextAvailableIndex = 0;
        } else if (currentAvailableIndex >= availableIndices.length - 1) {
            nextAvailableIndex = 0;
        } else {
            nextAvailableIndex = currentAvailableIndex + 1;
        }
        
        const nextIndex = availableIndices[nextAvailableIndex];
        
        if (nextIndex !== undefined && smokeLayers[nextIndex] && smokeLayers[nextIndex].layer) {
            showTimeIndex(nextIndex);
            document.getElementById('timeSlider').value = nextIndex;
        }
        
    }, animationSpeed);
}

/**
 * Stops the animation of smoke layers.
 * Updates the play/pause button state and clears the animation interval.
 */
function stopAnimation() {
    if (!isAnimating) return;
    
    isAnimating = false;
    const playButton = document.getElementById('playButton');
    playButton.textContent = '▶ Play';
    playButton.classList.remove('playing');
    
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
}

/**
 * Updates the animation speed based on the selected value from the speed dropdown.
 * If animation is currently playing, it restarts the interval with the new speed.
 */
function updateAnimationSpeed() {
    const speedSelect = document.getElementById('speedSelect');
    animationSpeed = parseInt(speedSelect.value);
    
    if (isAnimating) {
        clearInterval(animationInterval);
        animationInterval = null;
        
        animationInterval = setInterval(() => {
            const availableIndices = [];
            for (let i = 0; i < smokeLayers.length; i++) {
                if (smokeLayers[i] && smokeLayers[i].layer) {
                    availableIndices.push(i);
                }
            }
            
            if (availableIndices.length === 0) {
                stopAnimation();
                return;
            }
            
            const currentAvailableIndex = availableIndices.indexOf(currentTimeIndex);
            let nextAvailableIndex;
            
            if (currentAvailableIndex === -1) {
                nextAvailableIndex = 0;
            } else if (currentAvailableIndex >= availableIndices.length - 1) {
                nextAvailableIndex = 0;
            } else {
                nextAvailableIndex = currentAvailableIndex + 1;
            }
            
            const nextIndex = availableIndices[nextAvailableIndex];
            
            if (nextIndex !== undefined && smokeLayers[nextIndex] && smokeLayers[nextIndex].layer) {
                showTimeIndex(nextIndex);
                document.getElementById('timeSlider').value = nextIndex;
            }
            
        }, animationSpeed);
    }
}

/**
 * Makes the "Continue with Available Data" button visible in the loading overlay.
 */
function showSkipButton() {
    document.getElementById('skipButton').style.display = 'block';
}

/**
 * Makes the error log container visible in the loading overlay.
 */
function showErrorLog() {
    document.getElementById('errorLog').style.display = 'block';
}

/**
 * Updates the content of the error log with the latest loading errors.
 * Displays the last 5 errors.
 */
function updateErrorLog() {
    const errorLog = document.getElementById('errorLog');
    if (loadingErrors.length > 0) {
        errorLog.innerHTML = loadingErrors.slice(-5).join('<br>');
        errorLog.style.display = 'block';
    }
}

/**
 * Updates the displayed current time and relative hour in the control panel.
 * 
 * @param {number} index - The current index in the `timeExtents` array.
 */
function updateTimeDisplay(index) {
    const timeDisplay = document.getElementById('currentTimeDisplay');
    if (timeExtents[index]) {
        const timeInfo = timeExtents[index];
        const date = new Date(timeInfo.start);

        // Options for abbreviated month and 1 or 2 digit date
        const dateOptions = { month: 'short', day: 'numeric' };
        const formattedDate = date.toLocaleDateString([], dateOptions);

        const timeOptions = { hour: '2-digit', minute: '2-digit' };
        const timeString = date.toLocaleTimeString([], timeOptions);

        const relativeHourText = `${timeInfo.relativeHour >= 0 ? '+' : ''}${timeInfo.relativeHour}h`;

        timeDisplay.innerHTML = `
            ${formattedDate} ${timeString} (${relativeHourText})
        `;
    }
}

/**
 * Updates the width of the loading progress bar.
 * 
 * @param {number} progress - The progress percentage (0-100).
 */
function updateLoadingProgress(progress) {
    document.getElementById('loadingBar').style.width = progress + '%';
}

/**
 * Updates the text message displayed in the loading overlay.
 * 
 * @param {string} text - The new html content for the loading details.
 */
function updateLoadingDetails(html) {
    document.getElementById('loadingDetails').innerHTML = html;
}

/**
 * Hides the loading overlay by adding the 'hidden' class.
 */
function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}
                    
/**
 * Parses a smoke class description string or density value into a numerical density estimate (0-100).
 * Handles various string inputs like 'light', 'moderate', 'heavy', 'dense', and extracts numbers.
 * 
 * @param {string|number} classDesc - The smoke class description or a numerical density.
 * @returns {number} An estimated numerical smoke density.
 */
function parseSmokeClassDesc(classDesc) {
    if (!classDesc) return 0;
    
    const str = classDesc.toString().toLowerCase();
    
    const numbers = str.match(/\d+/g);
    if (numbers && numbers.length > 0) {
        return Math.max(...numbers.map(n => parseInt(n)));
    }
    
    if (str.includes('light') || str.includes('low')) return 10;
    if (str.includes('moderate') || str.includes('medium')) return 35;
    if (str.includes('heavy') || str.includes('high')) return 60;
    if (str.includes('dense') || str.includes('very')) return 85;
    
    return 0;
}

/**
 * Determines the fill color for a smoke layer based on its properties (density).
 * 
 * @param {object} properties - The properties object of the smoke feature.
 * @returns {string} A hexadecimal color string.
 */
function getSmokeColor(properties) {
    let density = 0;
    
    if (properties.smoke_classdesc) {
        density = parseSmokeClassDesc(properties.smoke_classdesc);
    } else if (properties.DENSITY) {
        density = properties.DENSITY;
    } else if (properties.Smoke_Fcst) {
        density = properties.Smoke_Fcst;
    } else if (properties.CLASS) {
        density = parseSmokeClassDesc(properties.CLASS);
    }
    
    if (density <= 15) return '#ffff99';
    else if (density <= 35) return '#ffcc66';
    else if (density <= 60) return '#ff9933';
    else return '#cc6600';
}

/**
 * Determines the fill opacity for a smoke layer based on its properties (density).
 * Ensures opacity is within a reasonable visual range (0.4 to 0.8).
 * 
 * @param {object} properties - The properties object of the smoke feature.
 * @returns {number} A float between 0 and 1 representing opacity.
 */
function getSmokeOpacity(properties) {
    let density = 0;
    
    if (properties.smoke_classdesc) {
        density = parseSmokeClassDesc(properties.smoke_classdesc);
    } else if (properties.DENSITY) {
        density = properties.DENSITY;
    } else if (properties.Smoke_Fcst) {
        density = properties.Smoke_Fcst;
    }
    
    return Math.min(0.8, 0.4 + (density / 100) * 0.4);
}

/**
 * Defines the styling function for Leaflet GeoJSON smoke layers.
 * Sets fill color and opacity based on smoke density.
 * 
 * @param {object} feature - The GeoJSON feature object.
 * @returns {object} An object containing Leaflet style properties.
 */
function smokeStyle(feature) {
    const properties = feature.properties;
    
    return {
        fillColor: getSmokeColor(properties),
        weight: 0,
        opacity: 0,
        color: 'transparent',
        fillOpacity: getSmokeOpacity(properties)
    };
}

/**
 * Creates the HTML content for a smoke forecast layer's popup.
 * Displays time information and all available properties of the smoke feature.
 * 
 * @param {object} properties - The properties object of the smoke feature.
 * @param {object} timeExtent - The time extent object associated with this smoke layer.
 * @returns {string} The HTML string for the popup content.
 */
function createSmokePopupContent(properties, timeExtent) {
    let content = `<div class="popup-content">`
        + `<h3>Smoke Forecast</h3>`
        + `<div class="popup-content-info">`;
    
    if (timeExtent) {
        const forecastTime = new Date(timeExtent.start);
        const relativeHourText = `${timeExtent.relativeHour >= 0 ? '+' : ''}${timeExtent.relativeHour}`;
        const timeType = timeExtent.isPast ? 'Historical' : (timeExtent.isFuture ? 'Forecast' : 'Current');
        
        content += `<span class="label">Time:</span><span class="value">${forecastTime.toLocaleString()}</span>`;
        content += `<span class="label">Relative:</span><span class="value">${relativeHourText} hours (${timeType})</span>`;
        content += `<span class="label">Period:</span><span class="value">Hour ${timeExtent.hour + 1}</span>`;
    }
    
    Object.keys(properties).forEach(key => {
        if (properties[key] !== null && key !== 'OBJECTID') {
            let displayKey = key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
            displayKey = displayKey.charAt(0).toUpperCase() + displayKey.slice(1);
            content += `<span class="label">${displayKey}:</span><span class="value">${properties[key]}</span>`;
        }
    });
    
    content += '</div></div>';
    return content;
}

/**
 * Converts Web Mercator (EPSG:3857) coordinates to Latitude and Longitude (EPSG:4326).
 * 
 * @param {number} x - The X (easting) coordinate in Web Mercator.
 * @param {number} y - The Y (northing) coordinate in Web Mercator.
 * @returns {Array<number>} An array `[longitude, latitude]` in degrees.
 */
function webMercatorToLatLng(x, y) {
    const lng = (x / 20037508.34) * 180;
    let lat = (y / 20037508.34) * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return [lng, lat];
}

/**
 * Converts an ESRI JSON geometry object (e.g., from ArcGIS REST services) into a GeoJSON geometry object.
 * Handles Point, Polyline (paths), and Polygon (rings) types, performing Web Mercator to LatLng conversion if needed.
 * 
 * @param {object} esriGeom - The ESRI JSON geometry object.
 * @returns {object|null} A GeoJSON geometry object, or null if the input is invalid or an error occurs.
 * @throws {Error} If the geometry structure is invalid or coordinates are not finite after transformation.
 */
function convertEsriGeometry(esriGeom) {
    if (!esriGeom) {
        if (DEBUG) console.warn('No geometry provided');
        return null;
    }
    
    try {
        if (esriGeom.rings) {
            const transformedRings = esriGeom.rings.map(ring => {
                if (!Array.isArray(ring)) {
                    throw new Error('Invalid ring structure');
                }
                
                return ring.map(coord => {
                    if (!Array.isArray(coord) || coord.length < 2) {
                        throw new Error('Invalid coordinate structure');
                    }
                    
                    let lng = coord[0];
                    let lat = coord[1];
                    
                    if (isWebMercatorCoordinate(lng, lat)) {
                        const transformed = webMercatorToLatLng(lng, lat);
                        lng = transformed[0];
                        lat = transformed[1];
                    }
                    
                    // Handle longitude wrap-around for -180/180
                    if (lng > 180) {
                        lng = lng - 360;
                    }
                    
                    if (!isFinite(lng) || !isFinite(lat)) {
                        throw new Error('Invalid coordinate values after transformation');
                    }
                    
                    lng = Math.max(-180, Math.min(180, lng));
                    lat = Math.max(-90, Math.min(90, lat));
                    
                    return [lng, lat];
                });
            });
            
            if (transformedRings.length === 0 || transformedRings[0].length < 4) {
                throw new Error('Insufficient points for polygon');
            }
            
            return {
                type: "Polygon",
                coordinates: transformedRings
            };
            
        } else if (esriGeom.paths) {
            const transformedPaths = esriGeom.paths.map(path => {
                if (!Array.isArray(path)) {
                    throw new Error('Invalid path structure');
                }
                
                return path.map(coord => {
                    if (!Array.isArray(coord) || coord.length < 2) {
                        throw new Error('Invalid coordinate structure');
                    }
                    
                    let lng = coord[0];
                    let lat = coord[1];
                    
                    if (isWebMercatorCoordinate(lng, lat)) {
                        const transformed = webMercatorToLatLng(lng, lat);
                        lng = transformed[0];
                        lat = transformed[1];
                    }
                    
                    // Handle longitude wrap-around for -180/180
                    if (lng > 180) {
                        lng = lng - 360;
                    }
                    
                    if (!isFinite(lng) || !isFinite(lat)) {
                        throw new Error('Invalid coordinate values after transformation');
                    }
                    
                    lng = Math.max(-180, Math.min(180, lng));
                    lat = Math.max(-90, Math.min(90, lat));
                    
                    return [lng, lat];
                });
            });
            
            if (transformedPaths.length === 0 || transformedPaths[0].length < 2) {
                throw new Error('Insufficient points for linestring');
            }
            
            return {
                type: "LineString",
                coordinates: transformedPaths[0]
            };
            
        } else if (typeof esriGeom.x === 'number' && typeof esriGeom.y === 'number') {
            let lng = esriGeom.x;
            let lat = esriGeom.y;
            
            if (isWebMercatorCoordinate(lng, lat)) {
                const transformed = webMercatorToLatLng(lng, lat);
                lng = transformed[0];
                lat = transformed[1];
            }
            
            // Handle longitude wrap-around for -180/180
            if (lng > 180) {
                lng = lng - 360;
            }
            
            if (!isFinite(lng) || !isFinite(lat)) {
                throw new Error('Invalid coordinate values after transformation');
            }
            
            lng = Math.max(-180, Math.min(180, lng));
            lat = Math.max(-90, Math.min(90, lat));
            
            return {
                type: "Point",
                coordinates: [lng, lat]
            };
        }
        
        if (DEBUG) console.warn('Unknown geometry type:', esriGeom);
        return null;
        
    } catch (error) {
        if (DEBUG) console.error('Error converting geometry:', error, esriGeom);
        return null;
    }
}
        
/**
 * Kicks it all off.
 */
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    
    // Auto-refresh traffic, fire, and air quality data at the specified interval
    setInterval(() => {
        if (!isLoadingTraffic) {
            loadAllTrafficAndFireData();
        }
    }, AUTO_RELOAD_DELAY);
});
