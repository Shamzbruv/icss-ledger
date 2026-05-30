/**
 * Mock Database: Styles & Options
 * Defines all customizable parts of the suit.
 */

window.DB_Styles = {
    jacket: {
        lapel: [
            { id: 'lapel_notch', name: 'Notch Lapel', price: 0, image: 'notch.png' },
            { id: 'lapel_peak', name: 'Peak Lapel', price: 0, image: 'peak.png' },
            { id: 'lapel_shawl', name: 'Shawl Collar', price: 50, image: 'shawl.png' } // Premium option
        ],
        closure: [
            { id: 'close_sb2', name: 'Single Breasted (2 Button)', price: 0 },
            { id: 'close_sb1', name: 'Single Breasted (1 Button)', price: 0 },
            { id: 'close_db', name: 'Double Breasted (6x2)', price: 100 }
        ],
        pockets: [
            { id: 'pock_flap', name: 'Flap Pockets', price: 0 },
            { id: 'pock_patch', name: 'Patch Pockets', price: 0 },
            { id: 'pock_jetted', name: 'Jetted Pockets', price: 0 }
        ],
        construction: [
            { id: 'const_half', name: 'Half Canvas', price: 0, desc: 'Structured chest, lighter body.' },
            { id: 'const_full', name: 'Full Canvas', price: 150, desc: 'Molds to your body over time.' },
            { id: 'const_uncon', name: 'Unconstructed', price: -50, desc: 'Soft, casual, lightweight.' }
        ]
    },
    trousers: {
        fit: [
            { id: 'fit_slim', name: 'Slim Fit', price: 0 },
            { id: 'fit_reg', name: 'Regular Fit', price: 0 },
            { id: 'fit_rel', name: 'Relaxed Fit', price: 0 }
        ],
        waistband: [
            { id: 'waist_belt', name: 'Belt Loops', price: 0 },
            { id: 'waist_side', name: 'Side Adjusters', price: 30 },
            { id: 'waist_clean', name: 'Clean (No Loops)', price: 0 }
        ],
        hem: [
            { id: 'hem_plain', name: 'Plain Hem', price: 0 },
            { id: 'hem_turn', name: 'Turn-up (4cm)', price: 0 }
        ]
    }
};
