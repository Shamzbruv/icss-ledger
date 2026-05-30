/**
 * Configuration Logic Rules
 * Defines compatibility and overrides.
 */

window.ConfigRules = {
    // Return true if valid, or a string reason if invalid
    checkCompatibility: function (currentConfig, newOptionCategory, newOptionId) {

        // Rule: Tuxedo Fabrics (Formal) cannot have Patch Pockets or Notch Lapels
        if (currentConfig.fabric && currentConfig.fabric.category === 'Formal') {
            if (newOptionCategory === 'pockets' && newOptionId === 'pock_patch') {
                return "Formal Tuxedos cannot have Patch pockets.";
            }
            if (newOptionCategory === 'lapel' && newOptionId === 'lapel_notch') {
                return "Tuxedos typically require Peak or Shawl lapels.";
            }
        }

        // Rule: Double Breasted Jackets generally don't use Notch Lapels
        if (currentConfig.jacket && currentConfig.jacket.closure === 'close_db') {
            if (newOptionCategory === 'lapel' && newOptionId === 'lapel_notch') {
                return "Double Breasted jackets look best with Peak lapels.";
            }
        }

        return true;
    },

    // Get default options for a given fabric category
    getDefaultsForFabric: function (fabricCategory) {
        if (fabricCategory === 'Formal') {
            return {
                jacket: { lapel: 'lapel_peak', closure: 'close_sb1', pockets: 'pock_jetted', construction: 'const_full' },
                trousers: { fit: 'fit_slim', waistband: 'waist_side', hem: 'hem_plain' }
            };
        }
        if (fabricCategory === 'Casual') {
            return {
                jacket: { lapel: 'lapel_notch', closure: 'close_sb2', pockets: 'pock_patch', construction: 'const_uncon' },
                trousers: { fit: 'fit_rel', waistband: 'waist_belt', hem: 'hem_turn' }
            };
        }
        // Default Business
        return {
            jacket: { lapel: 'lapel_notch', closure: 'close_sb2', pockets: 'pock_flap', construction: 'const_half' },
            trousers: { fit: 'fit_slim', waistband: 'waist_belt', hem: 'hem_plain' }
        };
    }
};
