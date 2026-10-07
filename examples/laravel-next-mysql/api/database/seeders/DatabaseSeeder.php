<?php

namespace Database\Seeders;

use App\Models\Post;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        Post::create([
            'title' => 'One environment per branch',
            'body' => 'Each branch gets its own front, API and database, on its own URLs.',
        ]);
        Post::create([
            'title' => 'Hello from MySQL',
            'body' => 'This post was seeded by php artisan migrate --seed, and read by the front through the API.',
        ]);
    }
}
