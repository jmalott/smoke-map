<?php
/*
Plugin Name: Smoke Map Block
Description: Provides a Gutenberg block to display the smoke map with ACF options.
Version: 0.1.0
*/

if ( ! defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}

function smoke_map_register_block() {
    $dir = plugin_dir_path( __FILE__ );

    // Register style and script
    wp_register_style( 'smoke-map-style', plugins_url( 'assets/main.css', __FILE__ ), array(), '1.0' );
    wp_register_script( 'smoke-map-script', plugins_url( 'assets/main.js', __FILE__ ), array(), '1.0', true );

    // Localize settings for JS
    $settings = array(
        'darkMode' => false,
    );
    if ( function_exists( 'get_field' ) ) {
        $settings['darkMode'] = (bool) get_field( 'smoke_map_dark_mode', 'option' );
    }
    wp_add_inline_script( 'smoke-map-script', 'window.smokeMapSettings = ' . wp_json_encode( $settings ) . ';', 'before' );

    register_block_type( __DIR__ . '/blocks/smoke-map' );
}
add_action( 'init', 'smoke_map_register_block' );

function smoke_map_register_acf_options() {
    if ( function_exists( 'acf_add_options_page' ) ) {
        acf_add_options_page( array(
            'page_title' => 'Smoke Map Settings',
            'menu_title' => 'Smoke Map',
            'menu_slug'  => 'smoke-map-settings',
            'capability' => 'manage_options',
            'redirect'   => false,
        ) );

        acf_add_local_field_group( array(
            'key' => 'group_smoke_map',
            'title' => 'Smoke Map Settings',
            'fields' => array(
                array(
                    'key' => 'field_enable_smoke_map',
                    'label' => 'Enable Smoke Map',
                    'name' => 'enable_smoke_map',
                    'type' => 'true_false',
                    'ui' => 1,
                    'default_value' => 1,
                ),
                array(
                    'key' => 'field_dark_mode',
                    'label' => 'Dark Mode',
                    'name' => 'smoke_map_dark_mode',
                    'type' => 'true_false',
                    'ui' => 1,
                    'default_value' => 0,
                ),
            ),
            'location' => array(
                array(
                    array(
                        'param' => 'options_page',
                        'operator' => '==',
                        'value' => 'smoke-map-settings',
                    ),
                ),
            ),
        ) );
    }
}
add_action( 'acf/init', 'smoke_map_register_acf_options' );
?>
