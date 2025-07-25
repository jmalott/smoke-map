<?php
/**
 * Updated Version - Open-Meteo Air Quality API Proxy with US AQI and Caching
 * Now uses US AQI instead of European AQI
 * With 12-hour caching to reduce API calls
 * Enhanced to support current data and custom parameters
 */

// Enable error reporting for debugging
ini_set('display_errors', 1);
error_reporting(E_ALL);

// Set headers for JSON response and CORS
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Cache configuration
define('CACHE_DURATION_HOURS', 12);
define('CACHE_DURATION_SECONDS', CACHE_DURATION_HOURS * 3600);
define('CACHE_DIR', __DIR__ . '/cache');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

/**
 * Initialize cache directory
 */
function initializeCache() {
    if (!is_dir(CACHE_DIR)) {
        if (!mkdir(CACHE_DIR, 0755, true)) {
            throw new Exception('Failed to create cache directory: ' . CACHE_DIR);
        }
    }
    
    if (!is_writable(CACHE_DIR)) {
        throw new Exception('Cache directory is not writable: ' . CACHE_DIR);
    }
}

/**
 * Generate cache key from request parameters
 */
function generateCacheKey($params) {
    // Sort parameters for consistent cache keys
    ksort($params);
    
    // Remove debug parameter from cache key
    unset($params['debug']);
    
    // Create hash from parameters
    $keyString = http_build_query($params);
    return 'airquality_us_' . md5($keyString) . '.json';
}

/**
 * Check if cache file exists and is valid
 */
function isCacheValid($cacheFile) {
    if (!file_exists($cacheFile)) {
        return false;
    }
    
    $cacheTime = filemtime($cacheFile);
    $currentTime = time();
    
    return ($currentTime - $cacheTime) < CACHE_DURATION_SECONDS;
}

/**
 * Read data from cache file
 */
function readFromCache($cacheFile) {
    if (!file_exists($cacheFile)) {
        return null;
    }
    
    $cacheContent = file_get_contents($cacheFile);
    if ($cacheContent === false) {
        return null;
    }
    
    $data = json_decode($cacheContent, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        // Cache file is corrupted, delete it
        unlink($cacheFile);
        return null;
    }
    
    return $data;
}

/**
 * Write data to cache file
 */
function writeToCache($cacheFile, $data) {
    $jsonData = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($jsonData === false) {
        throw new Exception('Failed to encode data for caching');
    }
    
    $tempFile = $cacheFile . '.tmp';
    
    if (file_put_contents($tempFile, $jsonData, LOCK_EX) === false) {
        throw new Exception('Failed to write cache file: ' . $tempFile);
    }
    
    if (!rename($tempFile, $cacheFile)) {
        unlink($tempFile);
        throw new Exception('Failed to move cache file to final location');
    }
}

/**
 * Clean old cache files (optional maintenance)
 */
function cleanOldCache() {
    if (!is_dir(CACHE_DIR)) {
        return;
    }
    
    $files = glob(CACHE_DIR . '/airquality_*.json');
    $currentTime = time();
    
    foreach ($files as $file) {
        if (is_file($file) && ($currentTime - filemtime($file)) > CACHE_DURATION_SECONDS) {
            unlink($file);
        }
    }
}

/**
 * Main request handler with caching and debug information
 */
try {
    // Initialize cache system
    initializeCache();
    
    // Clean old cache files (run occasionally)
    if (rand(1, 100) === 1) {
        cleanOldCache();
    }
    
    // Get request parameters
    $lat = isset($_GET['lat']) ? floatval($_GET['lat']) : null;
    $lon = isset($_GET['lon']) ? floatval($_GET['lon']) : null;
    $coords = $_GET['coords'] ?? null;
    $type = $_GET['type'] ?? 'current';
    $dt = isset($_GET['dt']) ? intval($_GET['dt']) : null;
    $center_date = $_GET['center_date'] ?? null;
    $debug = isset($_GET['debug']) ? true : false;
    $force_refresh = isset($_GET['force_refresh']) ? true : false;
    
    // NEW: Support for custom parameters
    $custom_hourly = $_GET['hourly'] ?? null;
    $custom_current = $_GET['current'] ?? null;
    $custom_timezone = $_GET['timezone'] ?? null;
    $custom_domains = $_GET['domains'] ?? null;
    $start_date = $_GET['start_date'] ?? null;
    $end_date = $_GET['end_date'] ?? null;
    
    // NEW: Support for time filtering
    $start_time = $_GET['start_time'] ?? null; // Format: HH:MM (24-hour)
    $end_time = $_GET['end_time'] ?? null;     // Format: HH:MM (24-hour)
    
    // Validate request type
    if (!in_array($type, ['current', 'forecast', 'historical', 'extended', 'custom'])) {
        throw new Exception('Invalid request type. Must be: current, forecast, historical, extended, or custom');
    }
    
    // If custom parameters are provided, use custom type
    if ($custom_hourly || $custom_current || $start_date || $end_date) {
        $type = 'custom';
    }
    
    // Generate cache key from all relevant parameters
    $cacheParams = $_GET;
    $cacheKey = generateCacheKey($cacheParams);
    $cacheFile = CACHE_DIR . '/' . $cacheKey;
    
    // Check cache first (unless debug mode or force refresh)
    if (!$debug && !$force_refresh && isCacheValid($cacheFile)) {
        $cachedData = readFromCache($cacheFile);
        if ($cachedData !== null) {
            // Add cache metadata
            $cachedData['cache_info'] = [
                'cached' => true,
                'cache_time' => date('Y-m-d H:i:s', filemtime($cacheFile)),
                'expires_at' => date('Y-m-d H:i:s', filemtime($cacheFile) + CACHE_DURATION_SECONDS),
                'cache_duration_hours' => CACHE_DURATION_HOURS
            ];
            
            echo json_encode($cachedData, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
            exit;
        }
    }
    
    // Handle regional (multi-location) vs single location requests
    if ($coords) {
        $result = handleRegionalRequest($coords, $type, $dt, $center_date, $debug, $custom_hourly, $custom_current, $custom_timezone, $custom_domains, $start_date, $end_date, $start_time, $end_time);
    } else {
        if ($lat === null || $lon === null) {
            throw new Exception('Latitude and longitude are required for single location requests');
        }
        $result = handleSingleLocationRequest($lat, $lon, $type, $dt, $center_date, $debug, $custom_hourly, $custom_current, $custom_timezone, $custom_domains, $start_date, $end_date, $start_time, $end_time);
    }
    
    // Add cache metadata
    $result['cache_info'] = [
        'cached' => false,
        'cache_key' => $cacheKey,
        'cache_duration_hours' => CACHE_DURATION_HOURS,
        'generated_at' => date('Y-m-d H:i:s')
    ];
    
    // Save to cache (unless debug mode)
    if (!$debug) {
        try {
            writeToCache($cacheFile, $result);
        } catch (Exception $e) {
            // Don't fail the request if caching fails, just log it
            error_log("Cache write failed: " . $e->getMessage());
        }
    }
    
    echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'error' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
        'trace' => $e->getTraceAsString()
    ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
} catch (Error $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Internal server error: ' . $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine()
    ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
}

/**
 * Handle single location with US AQI parameters - UPDATED
 */
function handleSingleLocationRequest($lat, $lon, $type, $dt = null, $center_date = null, $debug = false, $custom_hourly = null, $custom_current = null, $custom_timezone = null, $custom_domains = null, $start_date = null, $end_date = null, $start_time = null, $end_time = null) {
    $baseUrl = 'https://air-quality-api.open-meteo.com/v1/air-quality';
    
    // Basic parameters
    $params = [
        'latitude' => $lat,
        'longitude' => $lon
    ];
    
    // Handle custom parameters first (for your specific use case)
    if ($type === 'custom') {
        if ($custom_hourly) {
            $params['hourly'] = $custom_hourly;
        }
        if ($custom_current) {
            $params['current'] = $custom_current;
        }
        if ($custom_timezone) {
            $params['timezone'] = $custom_timezone;
        }
        if ($custom_domains) {
            $params['domains'] = $custom_domains;
        }
        if ($start_date) {
            $params['start_date'] = $start_date;
        }
        if ($end_date) {
            $params['end_date'] = $end_date;
        }
    } else {
        // Default parameters for existing types
        $params['hourly'] = 'us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_no2,us_aqi_o3,us_aqi_so2,us_aqi_co,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,ammonia';
        $params['timezone'] = 'auto';
        
        // Add date parameters based on request type
        switch ($type) {
            case 'current':
                // Get last 24 hours of data only
                $params['past_days'] = 1;
                break;
                
            case 'forecast':
                // Get 5 days of forecast
                $params['forecast_days'] = 5;
                break;
                
            case 'historical':
                if (!$dt) {
                    throw new Exception('Historical requests require a datetime parameter');
                }
                $date = date('Y-m-d', $dt);
                $params['start_date'] = $date;
                $params['end_date'] = $date;
                break;
                
            case 'extended':
                // FIXED: Now properly returns 5 days past + 5 days future = 10 day view
                if ($center_date) {
                    $centerDate = new DateTime($center_date);
                } else {
                    $centerDate = new DateTime();
                }
                
                $startDate = clone $centerDate;
                $startDate->modify('-5 days');
                $endDate = clone $centerDate;
                $endDate->modify('+5 days');
                
                $params['start_date'] = $startDate->format('Y-m-d');
                $params['end_date'] = $endDate->format('Y-m-d');
                break;
        }
    }
    
    $url = $baseUrl . '?' . http_build_query($params);
    
    if ($debug) {
        // Return debug info instead of making the request
        return [
            'debug' => true,
            'url' => $url,
            'params' => $params,
            'lat' => $lat,
            'lon' => $lon,
            'type' => $type,
            'date_calculation' => [
                'center_date' => $center_date ?? 'today',
                'start_date' => $params['start_date'] ?? 'not set',
                'end_date' => $params['end_date'] ?? 'not set'
            ],
            'aqi_system' => 'US AQI'
        ];
    }
    
    $response = fetchApiData($url);
    
    // NEW: For custom requests, return the response with time filtering if specified
    if ($type === 'custom') {
        return formatCustomResponse($response, $lat, $lon, $type, $start_time, $end_time, $custom_timezone);
    }
    
    return formatSingleLocationResponse($response, $lat, $lon, $type);
}

/**
 * Handle regional request with US AQI parameters - UPDATED
 */
function handleRegionalRequest($coords, $type, $dt = null, $center_date = null, $debug = false, $custom_hourly = null, $custom_current = null, $custom_timezone = null, $custom_domains = null, $start_date = null, $end_date = null, $start_time = null, $end_time = null) {
    $coordPairs = explode(';', $coords);
    $allData = [];
    $errors = [];
    $debugInfo = [];
    
    // Process all locations
    foreach ($coordPairs as $index => $coordPair) {
        $coordPair = trim($coordPair);
        if (empty($coordPair)) {
            $errors[] = "Empty coordinate pair at index $index";
            continue;
        }
        
        $coordParts = explode(',', $coordPair);
        if (count($coordParts) !== 2) {
            $errors[] = "Invalid coordinate format at index $index: $coordPair";
            continue;
        }
        
        $lat = floatval(trim($coordParts[0]));
        $lon = floatval(trim($coordParts[1]));
        
        // Validate coordinates
        if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
            $errors[] = "Invalid coordinate values at index $index: lat=$lat, lon=$lon";
            continue;
        }
        
        try {
            $locationData = handleSingleLocationRequest($lat, $lon, $type, $dt, $center_date, $debug, $custom_hourly, $custom_current, $custom_timezone, $custom_domains, $start_date, $end_date, $start_time, $end_time);
            
            if ($debug) {
                $debugInfo[] = $locationData;
            } else {
                $allData[] = $locationData;
            }
            
        } catch (Exception $e) {
            $errors[] = "Location $index ($lat, $lon): " . $e->getMessage();
            continue;
        }
    }
    
    if ($debug) {
        return [
            'debug' => true,
            'total_locations' => count($coordPairs),
            'debug_info' => $debugInfo,
            'errors' => $errors,
            'aqi_system' => 'US AQI'
        ];
    }
    
    if (empty($allData)) {
        throw new Exception("No valid data retrieved. Errors: " . implode('; ', $errors));
    }
    
    // For regional requests, aggregate all location data
    if ($type === 'extended' && count($allData) > 1) {
        return aggregateRegionalData($allData, $type);
    }
    
    // For single location or simple cases, return first location's data
    $result = $allData[0];
    $result['locations_processed'] = count($allData);
    $result['total_locations'] = count($coordPairs);
    $result['errors'] = $errors;
    
    return $result;
}

/**
 * NEW: Format custom response to preserve original API structure with optional time filtering
 */
function formatCustomResponse($apiResponse, $lat, $lon, $type, $start_time = null, $end_time = null, $timezone = null) {
    // For custom requests, we want to preserve the original API response structure
    // while adding our own metadata and optional time filtering
    
    $result = $apiResponse;
    
    // Apply time filtering if specified
    if (($start_time || $end_time) && isset($result['hourly']['time'])) {
        $result = applyTimeFilter($result, $start_time, $end_time, $timezone);
    }
    
    // Add our metadata
    $result['proxy_info'] = [
        'coordinate' => [
            'lat' => floatval($lat),
            'lon' => floatval($lon)
        ],
        'type' => $type,
        'aqi_system' => 'US AQI',
        'processed_at' => date('Y-m-d H:i:s')
    ];
    
    // Add time filtering info if applied
    if ($start_time || $end_time) {
        $result['proxy_info']['time_filter'] = [
            'start_time' => $start_time,
            'end_time' => $end_time,
            'timezone' => $timezone ?? 'API default'
        ];
    }
    
    // Add data point counts if available
    if (isset($result['hourly']['time'])) {
        $result['proxy_info']['hourly_data_points'] = count($result['hourly']['time']);
    }
    
    if (isset($result['current'])) {
        $result['proxy_info']['current_data_available'] = true;
    }
    
    return $result;
}

/**
 * NEW: Apply time filtering to hourly data
 */
function applyTimeFilter($apiResponse, $start_time = null, $end_time = null, $timezone = null) {
    if (!isset($apiResponse['hourly']['time'])) {
        return $apiResponse;
    }
    
    $times = $apiResponse['hourly']['time'];
    $hourlyData = $apiResponse['hourly'];
    $filteredIndices = [];
    
    // If we have both start_time and end_time, treat it as a continuous range
    if ($start_time && $end_time) {
        // Get the first and last dates from the data
        $firstDateTime = new DateTime($times[0]);
        $lastDateTime = new DateTime(end($times));
        
        // Create start and end DateTime objects
        $startDate = clone $firstDateTime;
        $startDate->setTime((int)substr($start_time, 0, 2), (int)substr($start_time, 3, 2), 0);
        
        $endDate = clone $lastDateTime;
        $endDate->setTime((int)substr($end_time, 0, 2), (int)substr($end_time, 3, 2), 0);
        
        // Filter timestamps - include everything between start and end datetime
        foreach ($times as $index => $timeStr) {
            $currentDateTime = new DateTime($timeStr);
            
            if ($currentDateTime >= $startDate && $currentDateTime <= $endDate) {
                $filteredIndices[] = $index;
            }
        }
    } else {
        // Original behavior - apply time filter to each day
        // Parse start and end times
        $startHour = $start_time ? (int)substr($start_time, 0, 2) : 0;
        $startMinute = $start_time ? (int)substr($start_time, 3, 2) : 0;
        $endHour = $end_time ? (int)substr($end_time, 0, 2) : 23;
        $endMinute = $end_time ? (int)substr($end_time, 3, 2) : 59;
        
        // Convert to total minutes for easier comparison
        $startTotalMinutes = $startHour * 60 + $startMinute;
        $endTotalMinutes = $endHour * 60 + $endMinute;
        
        // Filter timestamps
        foreach ($times as $index => $timeStr) {
            $dateTime = new DateTime($timeStr);
            $hour = (int)$dateTime->format('H');
            $minute = (int)$dateTime->format('i');
            $totalMinutes = $hour * 60 + $minute;
            
            // Check if this time falls within our filter range
            $includeTime = true;
            
            if ($start_time && $totalMinutes < $startTotalMinutes) {
                $includeTime = false;
            }
            
            if ($end_time && $totalMinutes > $endTotalMinutes) {
                $includeTime = false;
            }
            
            if ($includeTime) {
                $filteredIndices[] = $index;
            }
        }
    }
    
    // Apply filtering to all hourly data arrays
    $filteredHourly = [];
    foreach ($hourlyData as $key => $values) {
        if ($key === 'time') {
            $filteredHourly[$key] = array_values(array_intersect_key($values, array_flip($filteredIndices)));
        } elseif (is_array($values)) {
            $filteredHourly[$key] = array_values(array_intersect_key($values, array_flip($filteredIndices)));
        } else {
            $filteredHourly[$key] = $values;
        }
    }
    
    // Update the response
    $apiResponse['hourly'] = $filteredHourly;
    
    return $apiResponse;
}

/**
 * Aggregate data from multiple locations for regional view
 */
function aggregateRegionalData($allData, $type) {
    if (empty($allData)) {
        throw new Exception("No data to aggregate");
    }
    
    // Use the first location's coordinate as representative
    $firstLocation = $allData[0];
    
    // Create time-based aggregation
    $timeAggregation = [];
    
    foreach ($allData as $locationData) {
        foreach ($locationData['data'] as $dataPoint) {
            $timestamp = $dataPoint['timestamp'];
            
            if (!isset($timeAggregation[$timestamp])) {
                $timeAggregation[$timestamp] = [
                    'timestamp' => $timestamp,
                    'aqi_sum' => 0,
                    'count' => 0,
                    'components_sum' => [
                        'co' => 0, 'no' => 0, 'no2' => 0, 'o3' => 0,
                        'so2' => 0, 'pm2_5' => 0, 'pm10' => 0, 'nh3' => 0
                    ],
                    'us_aqi_components_sum' => [
                        'us_aqi_pm2_5' => 0, 'us_aqi_pm10' => 0, 'us_aqi_no2' => 0,
                        'us_aqi_o3' => 0, 'us_aqi_so2' => 0, 'us_aqi_co' => 0
                    ]
                ];
            }
            
            $timeAggregation[$timestamp]['aqi_sum'] += $dataPoint['aqi'];
            $timeAggregation[$timestamp]['count']++;
            
            foreach ($dataPoint['components'] as $component => $value) {
                if (isset($timeAggregation[$timestamp]['components_sum'][$component])) {
                    $timeAggregation[$timestamp]['components_sum'][$component] += $value;
                }
            }
            
            // Add US AQI component aggregation
            if (isset($dataPoint['us_aqi_components'])) {
                foreach ($dataPoint['us_aqi_components'] as $component => $value) {
                    if (isset($timeAggregation[$timestamp]['us_aqi_components_sum'][$component])) {
                        $timeAggregation[$timestamp]['us_aqi_components_sum'][$component] += $value;
                    }
                }
            }
        }
    }
    
    // Calculate averages
    $aggregatedData = [];
    foreach ($timeAggregation as $timestamp => $data) {
        $count = $data['count'];
        
        $avgComponents = [];
        foreach ($data['components_sum'] as $component => $sum) {
            $avgComponents[$component] = $sum / $count;
        }
        
        $avgUSAqiComponents = [];
        foreach ($data['us_aqi_components_sum'] as $component => $sum) {
            $avgUSAqiComponents[$component] = round($sum / $count);
        }
        
        $aggregatedData[] = [
            'timestamp' => $timestamp,
            'aqi' => round($data['aqi_sum'] / $count),
            'components' => $avgComponents,
            'us_aqi_components' => $avgUSAqiComponents
        ];
    }
    
    // Sort by timestamp
    usort($aggregatedData, function($a, $b) {
        return $a['timestamp'] - $b['timestamp'];
    });
    
    return [
        'coordinate' => $firstLocation['coordinate'],
        'data' => $aggregatedData,
        'type' => $type,
        'data_points' => count($aggregatedData),
        'locations_processed' => count($allData),
        'aggregation_method' => 'average',
        'aqi_system' => 'US AQI'
    ];
}

/**
 * Improved fetch function with better error reporting
 */
function fetchApiData($url) {
    $context = stream_context_create([
        'http' => [
            'timeout' => 30, // Increased timeout for larger requests
            'user_agent' => 'Mozilla/5.0 (compatible; AirQualityMonitor/1.0)',
            'method' => 'GET'
        ]
    ]);
    
    $response = @file_get_contents($url, false, $context);
    
    if ($response === false) {
        $error = error_get_last();
        throw new Exception("Failed to fetch from URL: $url. Error: " . ($error['message'] ?? 'Unknown'));
    }
    
    // Check if we got HTML instead of JSON
    if (strpos(trim($response), '<') === 0) {
        throw new Exception("API returned HTML instead of JSON. Response: " . substr($response, 0, 200));
    }
    
    $data = json_decode($response, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new Exception("Invalid JSON from API. Error: " . json_last_error_msg() . ". Response: " . substr($response, 0, 200));
    }
    
    if (isset($data['error'])) {
        throw new Exception("API Error: " . ($data['reason'] ?? $data['error'] ?? 'Unknown API error'));
    }
    
    return $data;
}

/**
 * Enhanced response formatting to handle US AQI data
 */
function formatSingleLocationResponse($apiResponse, $lat, $lon, $type) {
    if (!isset($apiResponse['hourly']) || !isset($apiResponse['hourly']['time'])) {
        throw new Exception("Invalid API response structure. Keys: " . implode(', ', array_keys($apiResponse)));
    }
    
    $hourly = $apiResponse['hourly'];
    $times = $hourly['time'] ?? [];
    
    if (empty($times)) {
        throw new Exception("No time data in API response");
    }
    
    $data = [];
    
    // Process ALL hours for extended view (removed the artificial limit)
    $maxHours = count($times);
    if ($type === 'extended') {
        // For extended view, we want all the data points
        $maxHours = count($times);
    } else {
        // For other types, limit appropriately
        $maxHours = min(48, count($times));
    }
    
    for ($i = 0; $i < $maxHours; $i++) {
        $timestamp = strtotime($times[$i]);
        if ($timestamp === false) continue;
        
        // Use US AQI as primary AQI value
        $aqi = $hourly['us_aqi'][$i] ?? null;
        if ($aqi === null) continue; // Allow AQI of 0 but not null
        
        // US AQI uses a different scale (0-500+), so we need to keep the actual values
        // rather than forcing them into 1-5 range like European AQI
        $data[] = [
            'timestamp' => $timestamp,
            'aqi' => intval($aqi), // Keep original US AQI values
            'components' => [
                'co' => floatval($hourly['carbon_monoxide'][$i] ?? 0),
                'no' => 0, // Not available in this API
                'no2' => floatval($hourly['nitrogen_dioxide'][$i] ?? 0),
                'o3' => floatval($hourly['ozone'][$i] ?? 0),
                'so2' => floatval($hourly['sulphur_dioxide'][$i] ?? 0),
                'pm2_5' => floatval($hourly['pm2_5'][$i] ?? 0),
                'pm10' => floatval($hourly['pm10'][$i] ?? 0),
                'nh3' => floatval($hourly['ammonia'][$i] ?? 0)
            ],
            'us_aqi_components' => [
                'us_aqi_pm2_5' => intval($hourly['us_aqi_pm2_5'][$i] ?? 0),
                'us_aqi_pm10' => intval($hourly['us_aqi_pm10'][$i] ?? 0),
                'us_aqi_no2' => intval($hourly['us_aqi_no2'][$i] ?? 0),
                'us_aqi_o3' => intval($hourly['us_aqi_o3'][$i] ?? 0),
                'us_aqi_so2' => intval($hourly['us_aqi_so2'][$i] ?? 0),
                'us_aqi_co' => intval($hourly['us_aqi_co'][$i] ?? 0)
            ]
        ];
    }
    
    if (empty($data)) {
        throw new Exception("No valid AQI data found in response");
    }
    
    // Sort by timestamp (newest first for current, chronological for extended)
    if ($type === 'current') {
        usort($data, function($a, $b) { return $b['timestamp'] - $a['timestamp']; });
    } else {
        usort($data, function($a, $b) { return $a['timestamp'] - $b['timestamp']; });
    }
    
    return [
        'coordinate' => [
            'lat' => floatval($lat),
            'lon' => floatval($lon)
        ],
        'data' => $data,
        'type' => $type,
        'data_points' => count($data),
        'date_range' => [
            'start' => date('Y-m-d H:i', $data[0]['timestamp']),
            'end' => date('Y-m-d H:i', end($data)['timestamp'])
        ],
        'aqi_system' => 'US AQI',
        'aqi_scale' => [
            'good' => '0-50',
            'moderate' => '51-100',
            'unhealthy_sensitive' => '101-150',
            'unhealthy' => '151-200',
            'very_unhealthy' => '201-300',
            'hazardous' => '301+'
        ]
    ];
}

// Add a simple test endpoint
if (isset($_GET['test'])) {
    echo json_encode([
        'status' => 'OK',
        'php_version' => phpversion(),
        'extensions' => [
            'curl' => extension_loaded('curl'),
            'json' => extension_loaded('json'),
            'openssl' => extension_loaded('openssl')
        ],
        'file_get_contents_test' => function_exists('file_get_contents'),
        'stream_context_create_test' => function_exists('stream_context_create'),
        'current_time' => date('Y-m-d H:i:s'),
        'timezone' => date_default_timezone_get(),
        'cache_info' => [
            'cache_dir' => CACHE_DIR,
            'cache_duration_hours' => CACHE_DURATION_HOURS,
            'cache_writable' => is_writable(CACHE_DIR),
            'cache_exists' => is_dir(CACHE_DIR)
        ],
        'aqi_system' => 'US AQI',
        'supported_parameters' => [
            'us_aqi', 'us_aqi_pm2_5', 'us_aqi_pm10', 'us_aqi_no2', 
            'us_aqi_o3', 'us_aqi_so2', 'us_aqi_co', 'current', 'timezone', 'domains',
            'start_time', 'end_time'
        ]
    ], JSON_PRETTY_PRINT);
    exit;
}

?>