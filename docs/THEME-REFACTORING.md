# Theme System Refactoring

This document describes the refactoring of the theme system from a single `themes.css` file to individual theme files for better maintainability and organization.

## Overview

The theme system has been refactored to use individual CSS files for each theme, making it easier to:
- Maintain and update individual themes
- Add new themes without modifying a large file
- Debug theme-specific issues
- Improve code organization and readability

## File Structure

### Before Refactoring
```
src/
└── themes.css (720 lines, all themes in one file)
```

### After Refactoring
```
src/
├── themes.css (main theme loader with imports)
└── themes/
    ├── theme-dark.css (default theme)
    ├── theme-light.css
    ├── theme-dark-gray.css
    ├── theme-light-gray.css
    ├── theme-blue.css
    ├── theme-green.css
    ├── theme-high-contrast.css
    ├── theme-color-blind.css
    ├── theme-system.css (with media queries)
    ├── theme-midnight.css
    ├── theme-sunset.css
    ├── theme-rose.css
    ├── theme-rose-dark.css
    ├── theme-ocean.css
    └── theme-mocha.css
```

## Changes Made

### 1. Individual Theme Files
Each theme is now in its own file with the naming convention `theme-{name}.css`:
- **theme-dark.css**: Default theme (fallback)
- **theme-light.css**: Light theme with `:root` fallback
- **theme-system.css**: System theme with media queries for light/dark mode
- **theme-{name}.css**: All other themes

### 2. Main Theme Loader
The `src/themes.css` file now serves as a loader that:
- Imports all individual theme files using `@import` statements
- Provides a fallback with dark theme variables in `:root`
- Maintains backward compatibility

### 3. Default Theme
- **Dark theme** is now the default and fallback theme
- Configuration defaults to `'dark'` in `config.js`
- Fallback variables are set in `:root` in `themes.css`

### 4. Theme Application Logic
The existing theme application logic in `renderer.js` remains unchanged:
- `applyTheme()` function works with the new structure
- Theme class removal and addition works correctly
- System theme detection continues to function

## Benefits

### Maintainability
- **Individual files**: Each theme can be modified independently
- **Clear separation**: No more scrolling through 720 lines to find a theme
- **Easier debugging**: Theme-specific issues are isolated

### Scalability
- **Add new themes**: Simply create a new `theme-{name}.css` file
- **Remove themes**: Delete the file and remove the import
- **Modify themes**: Edit only the relevant file

### Performance
- **CSS imports**: Browsers handle imports efficiently
- **No duplication**: Each theme is loaded only once
- **Fallback system**: Ensures themes always work

### Development Experience
- **Better organization**: Clear file structure
- **Easier collaboration**: Multiple developers can work on different themes
- **Version control**: Smaller, focused changes

## Theme Files Details

### Standard Theme Structure
Each theme file follows this pattern:
```css
/* Theme Name - Description for ArcGIS Velocity Simulator */

body.theme-name,
[data-theme="theme-name"] {
  --bg-color: #value;
  --text-color: #value;
  /* ... all CSS variables ... */
}
```

### Special Cases

#### Light Theme (`theme-light.css`)
- Includes both `:root` and `body.light` selectors
- Provides fallback for light theme variables

#### System Theme (`theme-system.css`)
- Uses `@media (prefers-color-scheme: dark)` and `@media (prefers-color-scheme: light)`
- Automatically adapts to OS color scheme preference

#### High Contrast Theme (`theme-high-contrast.css`)
- Includes additional CSS rules for button styling
- Ensures proper contrast for accessibility

## Backward Compatibility

### Existing Code
- All existing theme application logic continues to work
- HTML files still reference `themes.css`
- Theme switching functionality unchanged

### Configuration
- Default theme remains `'dark'`
- All theme names and values preserved
- Configuration files remain compatible

## Testing

### Theme Switching
- All 15 themes can be switched via context menu
- System theme responds to OS color scheme changes
- Theme persistence works across application restarts

### Fallback Behavior
- If a theme file fails to load, dark theme fallback is used
- Application remains functional even with missing theme files
- Error handling prevents theme-related crashes

## Future Enhancements

### Potential Improvements
- **Theme validation**: CSS linting for theme files
- **Theme previews**: Thumbnail generation for theme selection
- **Custom themes**: User-created theme support
- **Theme categories**: Grouping themes by type (dark, light, colorful, etc.)

### Development Workflow
- **Theme templates**: Standard template for new themes
- **Theme testing**: Automated testing for theme consistency
- **Theme documentation**: Individual documentation for each theme

## Migration Notes

### For Developers
- No changes needed to existing theme application code
- New themes can be added by creating files in `src/themes/`
- Theme imports must be added to `src/themes.css`

### For Users
- No visible changes to theme functionality
- All existing themes remain available
- Theme switching behavior unchanged

## File Sizes

### Before Refactoring
- `themes.css`: ~720 lines, ~25KB

### After Refactoring
- `themes.css`: ~25 lines, ~1KB (loader)
- Individual theme files: ~30-50 lines each, ~1-2KB each
- Total: ~15KB (more efficient organization)

## Conclusion

The theme system refactoring improves maintainability, scalability, and developer experience while maintaining full backward compatibility. The modular approach makes it easier to manage themes and provides a solid foundation for future enhancements. 