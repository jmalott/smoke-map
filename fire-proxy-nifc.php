<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

// Load environment variables
function loadEnv($file) {
    if (!file_exists($file)) {
        return [];
    }
    
    $env = [];
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    
    foreach ($lines as $line) {
        if (strpos($line, '#') === 0) continue; // Skip comments
        if (strpos($line, '=') === false) continue; // Skip invalid lines
        
        list($key, $value) = explode('=', $line, 2);
        $env[trim($key)] = trim($value, '"\'');
    }
    
    return $env;
}

// Function to check if a point is within bounds
function isPointInBounds($x, $y, $bounds) {
    if (!$bounds) return true;
    
    return $x >= $bounds['xmin'] && $x <= $bounds['xmax'] && 
           $y >= $bounds['ymin'] && $y <= $bounds['ymax'];
}

// Function to check if a polygon intersects with bounds
function doesPolygonIntersectBounds($geometry, $bounds) {
    if (!$bounds) return true;
    
    $xmin = $bounds['xmin'];
    $ymin = $bounds['ymin'];
    $xmax = $bounds['xmax'];
    $ymax = $bounds['ymax'];
    
    // Handle different geometry formats
    $coordinates = null;
    
    if (isset($geometry['rings']) && is_array($geometry['rings'])) {
        // ArcGIS format
        $coordinates = $geometry['rings'];
    } elseif (isset($geometry['coordinates']) && is_array($geometry['coordinates'])) {
        // GeoJSON format
        if ($geometry['type'] === 'Polygon') {
            $coordinates = $geometry['coordinates'];
        } elseif ($geometry['type'] === 'MultiPolygon') {
            // For MultiPolygon, check each polygon
            foreach ($geometry['coordinates'] as $polygon) {
                if (doesPolygonIntersectBounds(['coordinates' => $polygon, 'type' => 'Polygon'], $bounds)) {
                    return true;
                }
            }
            return false;
        }
    }
    
    if (!$coordinates || !is_array($coordinates)) {
        return true; // If we can't parse, include it
    }
    
    // Check all rings for intersection
    foreach ($coordinates as $ring) {
        if (!is_array($ring)) continue;
        
        $ringMinX = PHP_FLOAT_MAX;
        $ringMaxX = PHP_FLOAT_MIN;
        $ringMinY = PHP_FLOAT_MAX;
        $ringMaxY = PHP_FLOAT_MIN;
        $hasValidPoints = false;
        
        foreach ($ring as $point) {
            if (!is_array($point) || count($point) < 2) continue;
            
            $x = floatval($point[0]);
            $y = floatval($point[1]);
            
            // Skip invalid coordinates
            if (!is_finite($x) || !is_finite($y)) continue;
            
            $hasValidPoints = true;
            $ringMinX = min($ringMinX, $x);
            $ringMaxX = max($ringMaxX, $x);
            $ringMinY = min($ringMinY, $y);
            $ringMaxY = max($ringMaxY, $y);
            
            // If any point is in bounds, include the polygon
            if (isPointInBounds($x, $y, $bounds)) {
                return true;
            }
        }
        
        if (!$hasValidPoints) continue;
        
        // More inclusive bounding box intersection test
        // Include if polygon bounding box intersects OR contains the query bounds
        $intersects = ($ringMaxX >= $xmin && $ringMinX <= $xmax && 
                      $ringMaxY >= $ymin && $ringMinY <= $ymax);
        
        // Also check if the polygon completely contains the query bounds
        $contains = ($ringMinX <= $xmin && $ringMaxX >= $xmax && 
                    $ringMinY <= $ymin && $ringMaxY >= $ymax);
        
        if ($intersects || $contains) {
            return true;
        }
    }
    
    return false;
}

// Function to parse bounds string
function parseBounds($boundsStr) {
    if (!$boundsStr) return null;
    
    $parts = explode(',', $boundsStr);
    if (count($parts) !== 4) return null;
    
    return [
        'xmin' => floatval($parts[0]),
        'ymin' => floatval($parts[1]),
        'xmax' => floatval($parts[2]),
        'ymax' => floatval($parts[3])
    ];
}

// Load .env file
$env = loadEnv('.env');

// ArcGIS credentials from environment
$arcgis_username = $env['ARCGIS_USERNAME'] ?? '';
$arcgis_password = $env['ARCGIS_PASSWORD'] ?? '';
$arcgis_portal = $env['ARCGIS_PORTAL'] ?? 'https://www.arcgis.com';

// Define available endpoints
$endpoints = [
    'incidents' => "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer/0/query",
    'perimeters' => "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer/1/query", // Current_Perimeters layer
    'perimeters_current' => "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer/1/query" // Same as above, for backward compatibility
];

// Get requested endpoint from query parameter (default to incidents for backward compatibility)
$endpoint_type = $_GET['endpoint'] ?? 'incidents';

// Validate endpoint
if (!array_key_exists($endpoint_type, $endpoints)) {
    http_response_code(400);
    echo json_encode([
        "error" => "Invalid endpoint",
        "message" => "Valid endpoints are: " . implode(', ', array_keys($endpoints)),
        "available_endpoints" => array_keys($endpoints)
    ]);
    exit;
}

$url = $endpoints[$endpoint_type];

// Get the desired bounds
$bbox = $_GET['bounds'] ?? '';
$parsedBounds = parseBounds($bbox);

// Function to get ArcGIS token
function getArcGISToken($username, $password, $portal) {
    if (empty($username) || empty($password)) {
        return null; // No credentials provided
    }
    
    $token_url = $portal . '/sharing/rest/generateToken';
    
    $token_params = [
        'username' => $username,
        'password' => $password,
        'referer' => $_SERVER['HTTP_HOST'] ?? 'localhost',
        'f' => 'json',
        'expiration' => '1440' // 24 hours in minutes
    ];
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $token_url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($token_params));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; Fire Data Proxy)');
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // For testing
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/x-www-form-urlencoded'
    ]);
    
    $response = curl_exec($ch);
    $curl_error = curl_error($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($response === false) {
        error_log("Token request failed: $curl_error");
        return null;
    }
    
    if ($http_code !== 200) {
        error_log("Token request returned HTTP $http_code");
        return null;
    }
    
    $token_data = json_decode($response, true);
    
    if (isset($token_data['error'])) {
        error_log("ArcGIS token error: " . json_encode($token_data['error']));
        return null;
    }
    
    return $token_data['token'] ?? null;
}

// Function to make authenticated request
function makeRequest($url, $params, $token = null) {
    // Add token to params if available
    if ($token) {
        $params['token'] = $token;
    }
    
    // Use POST for requests with tokens to avoid URL length limits
    $use_post = !empty($token) || strlen(http_build_query($params)) > 2000;
    
    if ($use_post) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; Fire Data Proxy)');
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // For testing
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/x-www-form-urlencoded'
        ]);
    } else {
        $query_string = http_build_query($params, '', '&', PHP_QUERY_RFC3986);
        $full_url = $url . '?' . $query_string;
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $full_url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (compatible; Fire Data Proxy)');
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); // For testing
    }
    
    $response = curl_exec($ch);
    $curl_error = curl_error($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($response === false) {
        error_log("Request failed: $curl_error");
        return [
            'response' => false,
            'error' => $curl_error,
            'auth_required' => false,
            'http_code' => $http_code
        ];
    }
    
    // Check if response indicates authentication required
    $data = json_decode($response, true);
    if (isset($data['error'])) {
        $error_code = $data['error']['code'] ?? 0;
        $error_message = $data['error']['message'] ?? '';
        
        // Common ArcGIS authentication error codes
        if (in_array($error_code, [499, 498, 400]) || 
            strpos($error_message, 'token') !== false ||
            strpos($error_message, 'Invalid token') !== false ||
            strpos($error_message, 'Token Required') !== false) {
            return [
                'response' => false,
                'error' => 'Authentication required: ' . $error_message,
                'auth_required' => true,
                'http_code' => $http_code
            ];
        }
    }
    
    return [
        'response' => $response,
        'error' => $curl_error,
        'auth_required' => false,
        'http_code' => $http_code
    ];
}

// Get token if credentials are available
$token = null;
if (!empty($arcgis_username) && !empty($arcgis_password)) {
    $token = getArcGISToken($arcgis_username, $arcgis_password, $arcgis_portal);
    if ($token) {
        error_log("Successfully obtained ArcGIS token");
    } else {
        error_log("Failed to obtain ArcGIS token");
    }
}

// Build query parameters based on endpoint type
$params = [
    'f' => 'json',
    'where' => '1=1',
    'outFields' => '*',
    'returnGeometry' => 'true',
    'outSR' => '4326',
    'resultRecordCount' => '5000' // Increase limit since we'll filter server-side
];

// Add bbox to params - even if ArcGIS doesn't filter perfectly, it might help
if ($bbox) {
    $params['bbox'] = $bbox;
}

// Add endpoint-specific parameters
if ($endpoint_type === 'perimeters' || $endpoint_type === 'perimeters_current') {
    // For perimeters, we might want to filter for active fires
    // You can customize this WHERE clause based on your needs
    $params['where'] = "1=1"; // Gets all current perimeters
    
    // Optional: Add date filtering for recent perimeters
    if (isset($_GET['days'])) {
        $days = intval($_GET['days']);
        if ($days > 0) {
            $date_threshold = date('Y-m-d', strtotime("-$days days"));
            $params['where'] = "CreateDate >= DATE '$date_threshold'";
        }
    }
}

// Allow custom where clause via query parameter
if (isset($_GET['where'])) {
    $params['where'] = $_GET['where'];
}

// Allow custom bbox via query parameter
if (isset($_GET['bbox'])) {
    $params['bbox'] = $_GET['bbox'];
}

// Allow custom field selection via query parameter
if (isset($_GET['fields'])) {
    $params['outFields'] = $_GET['fields'];
}

// Try the selected endpoint
$result = makeRequest($url, $params, $token);

// Handle authentication required
if ($result['auth_required']) {
    http_response_code(401);
    echo json_encode([
        "error" => "Authentication required",
        "message" => "ArcGIS token needed. Please configure ARCGIS_USERNAME and ARCGIS_PASSWORD in .env file",
        "endpoint" => $endpoint_type,
        "details" => $result['error'],
        "http_code" => $result['http_code']
    ]);
    exit;
}

// Handle general failure
if ($result['response'] === false) {
    http_response_code(500);
    echo json_encode([
        "error" => "Unable to retrieve fire data",
        "message" => "Service endpoint failed: " . $result['error'],
        "endpoint" => $endpoint_type,
        "url" => $url,
        "http_code" => $result['http_code']
    ]);
    exit;
}

// Parse response and apply server-side filtering
$response_data = json_decode($result['response'], true);
if ($response_data && is_array($response_data) && isset($response_data['features'])) {
    $original_count = count($response_data['features']);
    
    // Apply bounds filtering if bounds were specified
    if ($parsedBounds && $response_data['features']) {
        $filtered_features = [];
        
        foreach ($response_data['features'] as $feature) {
            $include = false;
            
            if (isset($feature['geometry'])) {
                $geometry = $feature['geometry'];
                
                // Check if it's a point (incidents)
                if (isset($geometry['x']) && isset($geometry['y'])) {
                    $include = isPointInBounds($geometry['x'], $geometry['y'], $parsedBounds);
                } 
                // Check if it's a polygon (perimeters)
                else {
                    $include = doesPolygonIntersectBounds($geometry, $parsedBounds);
                }
            } else {
                // If no geometry, include it (shouldn't happen but be safe)
                $include = true;
            }
            
            if ($include) {
                $filtered_features[] = $feature;
            }
        }
        
        $response_data['features'] = $filtered_features;
        $filtered_count = count($filtered_features);
        
        // Add filtering info to response
        $response_data['filtering_info'] = [
            'bounds_applied' => $bbox,
            'original_count' => $original_count,
            'filtered_count' => $filtered_count,
            'filtered_out' => $original_count - $filtered_count
        ];
        
        error_log("Filtered features: $original_count -> $filtered_count (removed " . ($original_count - $filtered_count) . ")");
    }
    
    // Add metadata
    $response_data['endpoint_info'] = [
        'type' => $endpoint_type,
        'url' => $url,
        'bbox' => $params['bbox'] ?? null,
        'where' => $params['where'],
        'timestamp' => date('c'),
        'authenticated' => !empty($token),
        'http_code' => $result['http_code']
    ];
    
    // Add usage instructions
    $response_data['usage'] = [
        'endpoints' => [
            'incidents' => 'Use ?endpoint=incidents for wildfire incident points (default)',
            'perimeters' => 'Use ?endpoint=perimeters for public fire perimeters',
            'perimeters_current' => 'Use ?endpoint=perimeters_current for current fire perimeters (may require auth)'
        ],
        'parameters' => [
            'endpoint' => 'incidents|perimeters|perimeters_current (default: incidents)',
            'bounds' => 'Bounding box: xmin,ymin,xmax,ymax (server-side filtering applied)',
            'where' => 'Custom WHERE clause for filtering',
            'fields' => 'Custom field selection (default: *)',
            'days' => 'For perimeters: filter by days since creation'
        ],
        'examples' => [
            'Get incidents' => '?endpoint=incidents',
            'Get public perimeters' => '?endpoint=perimeters',
            'Get current perimeters' => '?endpoint=perimeters_current',
            'Get recent perimeters' => '?endpoint=perimeters&days=7',
            'Custom area' => '?endpoint=perimeters&bounds=-123,44,-121,46',
            'Large fires only' => '?endpoint=perimeters&where=GIS_ACRES>1000'
        ]
    ];
    
    echo json_encode($response_data);
} else {
    // Return original response if we can't parse it
    echo $result['response'];
}
?>