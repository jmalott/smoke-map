<?php
// If map disabled via ACF option, return empty
if( function_exists('get_field') ) {
    $enabled = get_field('enable_smoke_map', 'option');
    if( $enabled === false ) {
        return '';
    }
    $dark_mode = get_field('smoke_map_dark_mode', 'option');
} else {
    $dark_mode = false;
}

$classes = $dark_mode ? 'smoke-map dark-mode' : 'smoke-map';
?>
<div class="<?php echo esc_attr($classes); ?>">
    <div class="custom-tile-chooser">
        <button id="defaultTilesBtn" class="custom-tile-chooser-button active" title="Default Map">🗺️</button>
        <button id="satelliteTilesBtn" class="custom-tile-chooser-button" title="Satellite Map">🛰️</button>
    </div>

    <div id="map"></div>

    <div class="loading" id="loading">
        <h3 id="loadingTitle">Interactive Fire, Air, and Road Conditions Map</h3>
        <div class="loading-progress" id="progressContainer" style="display: none;">
            <div class="loading-bar" id="loadingBar"></div>
        </div>
        <p id="loadingDetails">View past and future forecast smoke data, along with current fires, air quality, and traffic information in the region. Control playback speed once the data is loaded.</p>
        <div id="errorLog" class="error-log" style="display: none;"></div>
        <button onclick="startProgressiveLoading()" id="loadButton">Show Me The Data!</button>
        <p id="loadingDisclaimer"><i><b>Sources:</b> The National Weather Service (smoke forecast), The National Interagency Fire Center (fires), Open-Meteo (air quality), ODOT (road conditions).</i></p>
    </div>

    <div id="controls" class="controls">
        <div class="controls-grid">
            <div class="time-section">
                <div class="slider-container">
                    <input type="range" class="time-slider" id="timeSlider" min="0" max="47" value="0" step="1" onchange="onTimeSliderChange()">
                    <div class="slider-labels">
                        <span id="sliderStartLabel">-12h</span>
                        <span id="sliderEndLabel">+36h</span>
                    </div>
                </div>
                <div class="time-header">
                    <div class="time-display" id="currentTimeDisplay"></div>
                    <div class="animation-controls">
                        <div class="speed-control" id="speedControlContainer">
                            Speed: <select id="speedSelect" onchange="updateAnimationSpeed()" disabled>
                                <option value="2000">Slow</option>
                                <option value="1000" selected>Normal</option>
                                <option value="500">Fast</option>
                                <option value="250">Very Fast</option>
                            </select>
                        </div>
                        <button class="play-button" id="playButton" onclick="toggleAnimation()">▶ Play</button>
                    </div>
                </div>
            </div>
            <div class="layer-toggles">
                <div class="toggle-group">
                    <button id="toggleSmoke" class="toggle-btn smoke"><span>Hide </span>Smoke</button>
                    <button id="toggleFires" class="toggle-btn fire"><span>Hide</span>Fires</button>
                </div>
                <div class="toggle-group">
                    <button id="toggleCameras" class="toggle-btn traffic"><span>Hide </span>Cameras</button>
                    <button id="toggleIncidents" class="toggle-btn traffic"><span>Hide </span>Incidents</button>
                </div>
                <div id="airQualityToggleGroup" class="toggle-group">
                    <button id="toggleAirQuality" class="toggle-btn air-quality"><span>Hide </span>Air Quality</button>
                </div>
            </div>
            <div class="legend-section">
                <div class="legend-items">
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #ffff99;"></div>
                        <span>Light Smoke</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #ffcc66;"></div>
                        <span>Moderate</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #ff9933;"></div>
                        <span>Heavy Smoke</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #cc6600;"></div>
                        <span>Dense Smoke</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-icon fire-icon">🔥</div>
                        <span>Active Fires</span>
                    </div>
                    <div class="legend-item" id="airQualityLegendItem" style="display: none;">
                        <div class="legend-icon air-quality-icon">🌬️</div>
                        <span>Air Quality</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-icon camera-icon">📸</div>
                        <span>Cameras</span>
                    </div>
                    <div id="legend-incident-icon" class="legend-item">
                        <div class="legend-icon incident-icon">⚠️</div>
                        <span>Incidents</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
<?php
return '';
?>
